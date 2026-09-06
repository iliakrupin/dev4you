# Архитектура — КручуФичу (`dev4you`)

## Обзор

Multi-agent демо-система: пользователь ставит задачу через Telegram Mini App, один LLM-агент
формализует её, правит файлы этого же репозитория, открывает PR и мерджит в `main`; Vercel
пересобирает production, и приложение перерисовывает само себя.

Ключевые принципы:

- **State machine живёт в БД, а не в памяти процесса** — каждый шаг пайплайна читает и пишет
  статус задачи в Postgres (Drizzle), поэтому падение любой функции не теряет состояние.
- **Пайплайн разрезан на короткие шаги** — один LLM-вызов на Edge-функцию (`maxDuration = 25`),
  шаги связаны fire-and-forget `fetch` к самому себе; локальные git-команды запрещены — только
  Octokit REST + GraphQL.
- **Sandbox по умолчанию** — агент может писать только в whitelist-файлы; всё остальное валит
  задачу с `SandboxError`.

## Схема компонентов

```
[Telegram Mini App]                      [GitHub]                         [Vercel]
  форма /new ──POST /api/tasks──▶ [Next.js API (Edge/nodejs)]             production build
  главная / ◀─ списки задач ─────     │    │    │                        ▲
  AutoRefresh ◀─ GET /api/version ─   │    │    └─ Octokit: branch/       │
                                      │    │       commit/PR/merge ─────▶ main
                                      │    │
                    [LLM: Qwen (OpenAI SDK) или OpenRouter]
                                      │
                              [Vercel Postgres / Neon + Drizzle]
                               tasks, task_events, one_active_task
```

## Жизненный цикл задачи

```
queued
  → analyzing   (runAnalysis: 1 LLM-вызов → spec JSON, 3 попытки)
  → analyzed    (spec сохранён в tasks.spec)
  → implementing(runImplement: по одному файлу за HTTP-вызов, self-trigger)
  → ready_for_review (ветка task/N + коммит + PR созданы)
  → deploying   (immediate-merge, squash, через Octokit)
  → merged      (mergeCommitSha; ветка task/N удалена; Vercel пересобирает production)
  ↘ failed      (на любом шаге; errorMessage с префиксом этапа: analysis:/implement:/deploy:)
```

Статусы enum в БД: `queued, analyzing, analyzed, implementing, implemented, testing, tested,
deploying, ready_for_review, merged, failed, cancelled`. Фактически пайплайн использует
`queued…ready_for_review, deploying, merged, failed`; `testing` проставляется webhook'ом Vercel
(`deployment.created`), `implemented`, `tested`, `cancelled` — зарезервированы.

Компенсирующие механизмы:

- **Мьютекс**: активен только один статус из активных; SELECT-проверка в `POST /api/tasks`
  (дружелюбный 429) + частичный уникальный индекс `one_active_task` в БД как атомарный backstop
  (конкурентный INSERT падает с 23505 → тоже 429).
- **Watchdog-cron** (`/api/cron/watchdog`, каждые 5 мин из `vercel.json`): задача в активном
  статусе без `updatedAt` дольше 5 минут → `failed` (`watchdog: …`), слот освобождается.
- **Rate-limit**: 60 секунд между задачами от одного `telegram_id` (для anon — глобально).

## Подсистемы

### API-роуты

| Роут | Метод | Runtime | maxDuration | Назначение |
|---|---|---|---|---|
| `/api/tasks` | POST | edge | 25 | Создание задачи: initData-авторизация, мьютекс, rate-limit; запуск `runAnalysis` в `after()` |
| `/api/tasks/[id]/implement` | POST | edge | 25 | Один шаг implement + self-trigger следующего |
| `/api/tasks/[id]/retry` | POST | edge | 25 | Перезапуск failed-задачи: сброс в `queued` без дубликата, чистка ветки |
| `/api/tasks/[id]` | GET | nodejs | — | JSON задачи |
| `/api/tasks/[id]/delete` | DELETE | edge | 10 | Удаление задачи (события каскадом) |
| `/api/tasks/clear` | POST | edge | 10 | Удалить все задачи |
| `/api/admin/reset` | POST | nodejs | 60 | Reset к git-тегу `demo-baseline` (+ удаление задач, `?clearTasks=false`) |
| `/api/webhooks/vercel` | POST | nodejs | 30 | `deployment.created/succeeded/error/canceled`: preview URL, preview/prod-провал → failed |
| `/api/webhooks/github` | POST | edge | 25 | `deployment_status`: production failure → задача failed |
| `/api/cron/watchdog` | GET | nodejs | 30 | Vercel Cron с `Authorization: Bearer <CRON_SECRET>` |
| `/api/health` | GET | nodejs | — | Liveness-проба |
| `/api/version` | GET | nodejs | — | `VERCEL_GIT_COMMIT_SHA` текущего деплоя (для AutoRefresh) |

### Агентский пайплайн ([`lib/agent/runner.ts`](../lib/agent/runner.ts))

- **runAnalysis** — подгружает дерево whitelist-файлов с превью (`getSandboxFilesPreview`), один
  LLM-вызов (stream, `maxTokens 1200`) возвращает `TaskSpec` (zod-схема, толерантная к мусору:
  `z.unknown().transform(...)`). 3 попытки с паузой 1.5 c. После парсинга `targetFiles` и
  `filesToDelete` повторно фильтруются через sandbox.
- **runImplement** — по одному файлу за вызов: читает текущее содержимое из GitHub, LLM
  (non-stream, `maxTokens 1500`) возвращает diff `{ edits: [{find, replace}] }`; `applyEdits`
  заменяет только **первое** вхождение каждого `find`. Новые `@/`-импорты проверяются на
  существование (`validateNewImports`) до коммита. Результат накапливается в `tasks.producedFiles`,
  очередь — в `tasks.pendingFiles`.
- **finalizeImplement** — единая точка мержа: `createBranch(task/N)` → один GraphQL
  `createCommitOnBranch` (additions + deletions) → `openPullRequest` → immediate squash-merge →
  `deleteBranch(task/N)`.
- **revert** — отдельная ветка `runRevert`: берёт последний merge-коммит (или `spec.revertSha`),
  восстанавливает содержимое whitelist-файлов из родительского коммита.

### LLM ([`lib/agent/llm.ts`](../lib/agent/llm.ts))

OpenAI SDK, `timeout 22c`, `maxRetries 0`. Если задан `OPENROUTER_API_KEY` — внешний OpenRouter
(любая модель из каталога), иначе локальный Qwen из `QWEN_BASE_URL`. Edge запрещает fetch по
IP-адресам — URL вида `http://1.2.3.4:9999/v1` прозрачно подменяется на `<ip>.nip.io` (wildcard
DNS); при OpenRouter не активируется.

### Sandbox ([`lib/agent/sandbox.ts`](../lib/agent/sandbox.ts))

- `ALLOWED_PATTERNS` — whitelist на запись: `app/globals.css`, `tailwind.config.*`, публичные
  страницы (`app/page.tsx`, `app/new/**`, `app/tasks/[id]/**`, `app/(public)/**`),
  `components/**` кроме `*auto-refresh*`, статика `public/**`.
- `PROTECTED_FROM_DELETION` — можно редактировать, нельзя удалять (карточки, layout, страница
  задач…). Энфорсится на write-границе в `commitMultipleFiles`, а не только на анализе.
- Запрещено полностью: `.env*`, `lib/**`, `middleware.ts`, `package.json`, `.github/**`,
  `app/api/**` — всё, что не в whitelist, валит задачу с `SandboxError`.
- Prompt-injection: системный промпт аналитика инструктирует помечать такие задачи
  «Задача не может быть выполнена: вне sandbox» с пустым `targetFiles`.

### Интеграция с GitHub ([`lib/github.ts`](../lib/github.ts))

Octokit REST + GraphQL; каждый запрос с таймаутом 8 c (AbortController), base-SHA кэшируется на
30 c. Операции: чтение файла/дерева, создание ветки, `commitMultipleFiles` (один GraphQL-коммит на
все additions и deletions), открытие PR, squash-merge, удаление ветки, `getAllowedFilesAtRef` для
reset.

### Интеграция с Telegram ([`lib/telegram.ts`](../lib/telegram.ts))

`initData` валидируется по HMAC-SHA256 (secret = HMAC("WebAppData", bot_token)), constant-time
сравнение, replay-защита: `auth_date` старше 24 ч → отказ. Заголовок `x-telegram-init-data` не
передан → публичный демо-режим (`telegramUserId=0`, `username='anon'`); передан и не прошёл
проверку → 401 (fail-closed).

### Интеграция с Vercel (webhooks + AutoRefresh)

- **Vercel webhook** (`deployment.created/succeeded/error/canceled`): фиксирует preview URL,
  переводит `ready_for_review` → `testing`; preview-провал → `failed`. Мерж из webhook'ов убран —
  единая точка мержа в `finalizeImplement`.
- **GitHub webhook** (`deployment_status`): production failure по `mergeCommitSha` → задача
  `failed` со ссылкой на лог.
- **UI-обновление**: `<ListAutoRefresh/>` делает `router.refresh()` каждые 3 c;
  `<AutoRefresh/>` опрашивает `/api/version` и при смене commit SHA перезагружает страницу через
  `requestIdleCallback`.

## Хранилище ([`lib/db/schema.ts`](../lib/db/schema.ts))

| Таблица | Поля | Назначение |
|---|---|---|
| `tasks` | `id, createdAt, updatedAt, telegramUserId, telegramUsername, rawText, spec (jsonb TaskSpec), status, touchedFiles, pendingFiles, producedFiles, branchName, prNumber, prUrl, previewUrl, mergeCommitSha, errorMessage` | Задача и её состояние на всех этапах |
| `task_events` | `id, taskId (FK cascade), createdAt, stage, kind, message, metadata` | Журнал шагов пайплайна (таймлайн на карточке) |

- `task_status` — Postgres enum (см. жизненный цикл выше).
- `one_active_task` — частичный уникальный индекс `ON (true) WHERE status IN (<активные>)`:
  атомарный мьютекс «одна активная задача». Применяется `pnpm db:push`.
- `TaskSpec` (jsonb): `goal, targetFiles, changes, acceptanceCriteria, operation ('edit'|'revert'),
  revertSha?, filesToDelete?`.

## Структура каталогов

```
app/
  api/…                # Route Handlers (таблица выше)
  new/                 # форма постановки задачи
  tasks/[id]/          # redirect на главную (детальный экран удалён)
  page.tsx, layout.tsx # главная и layout Mini App
components/            # TaskCard, Timeline, StatusBadge, AutoRefresh, ListAutoRefresh, ThemeSwitcher
lib/
  agent/               # runner.ts (пайплайн), prompts.ts, llm.ts, sandbox.ts
  db/                  # schema.ts, index.ts (клиент Drizzle)
  github.ts            # обёртка Octokit
  telegram.ts          # валидация initData
  webhook-verify.ts    # HMAC-подписи (GitHub SHA-256, Vercel SHA-1), constant-time
  env.ts               # T3 Env + zod, единственная точка process.env
docs/                  # документация
```

## Ключевые абстракции

| Абстракция | Где | Смысл |
|---|---|---|
| `TaskSpec` | `lib/db/schema.ts` | Структурированный план задачи, который возвращает аналитик |
| `Task` / `TaskEvent` | `lib/db/schema.ts` | Строки `tasks` / `task_events` (state machine в БД) |
| `isAllowed` / `assertAllowed` | `lib/agent/sandbox.ts` | Whitelist-проверка пути, `SandboxError` при нарушении |
| `PROTECTED_FROM_DELETION` | `lib/agent/sandbox.ts` | Файлы, которые нельзя удалять даже через `filesToDelete` |
| `one_active_task` | `lib/db/schema.ts` | Частичный уникальный индекс — атомарный мьютекс |
| `runAnalysis` / `runImplement` / `finalizeImplement` | `lib/agent/runner.ts` | Шаги пайплайна (по одному LLM-вызову / мержу за вызов) |
| `llm()` / `qwenModel()` | `lib/agent/llm.ts` | Выбор бэкенда LLM: OpenRouter или локальный Qwen |
| `commitMultipleFiles` | `lib/github.ts` | Один GraphQL-коммит (additions + deletions) с sandbox-проверкой |
| `validateInitData` | `lib/telegram.ts` | HMAC + replay-защита Telegram Mini App |
| `verifyGithubSignature` / `verifyVercelSignature` | `lib/webhook-verify.ts` | Fail-closed проверка подписей webhook'ов |
| `<AutoRefresh/>` / `<ListAutoRefresh/>` | `components/` | Hard reload по смене SHA / soft refresh списка |

## Развёртывание

Vercel Pro + Vercel Postgres; cron и env — из `vercel.json` и Vercel Environment Variables.
Пошагово: [docs/DEPLOYMENT.md](DEPLOYMENT.md); переменные окружения:
[docs/CONFIGURATION.md](CONFIGURATION.md).

## Куда дальше

- [docs/GETTING-STARTED.md](GETTING-STARTED.md) — поднять проект локально.
- [docs/CONFIGURATION.md](CONFIGURATION.md) — все переменные окружения и секреты.
- [docs/DEVELOPMENT.md](DEVELOPMENT.md) — команды, стиль кода, Drizzle, CI.
- [docs/SPEC.md](SPEC.md) — видение, аудитория, ограничения и принятые решения.
