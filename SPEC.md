# SPEC — КручуФичу (`dev4you`)

Полная спецификация продукта: видение, аудитория, архитектура, ограничения и сценарии. Собрана из итогов интервью с автором и накопленных решений за день разработки.

## 1. Видение

**«Аналитик без разработчиков», и доказательство — через саморазвитие.** Пользователь пишет задачу простым человеческим языком («поменяй цвета рандомно», «убери эту кнопку», «переименуй заголовок»), один LLM-агент сам её формализует, пишет код, открывает PR, мержит в main и выкатывает в production — без программистов в середине. Демонстрация работает над собственным кодом: **приложение перерисовывает само себя по запросу пользователя**, и это можно проверить по истории коммитов в публичном репозитории.

Долгосрочная цель — заменить рутинную часть работы команды разработки в корпоративном контуре, где код не должен покидать периметр компании и доступны только локальные LLM.

## 2. Целевая аудитория

**Первая итерация (демо):** русскоязычное AI-сообщество в Telegram. Технически грамотные люди, которым важны не только результат, но и прозрачность работы агентов: видимый pipeline, реальные diff'ы, открытый репозиторий, видимые провалы и реверты.

**Долгосрочно:** аналитики и менеджеры в средних/крупных российских компаниях, где требования службы информационной безопасности запрещают передачу кода во внешние LLM.

## 3. Эталонные сценарии демо

Над **самим дашбордом** (саморазвивающаяся система):

1. **«Сделай акцентный цвет красным»** — агент меняет CSS-переменные `--accent` / `--accent-soft` в `app/globals.css`, открывает PR, immediate-merge через Octokit, Vercel пересобирает production, главная сама перерисовывается. Это ключевой WOW-момент.
2. **«Откати последнее изменение темы»** — агент через `git revert` восстанавливает прежнее содержимое из родительского коммита.
3. **«Удали кнопку Очистить»** — агент идентифицирует и компонент, и его использование, использует `filesToDelete` для полного удаления.
4. **«Переименуй заголовок X в Y»** — простой find/replace через diff-формат.

После демо любой зритель может вернуть всё к исходному состоянию: `POST https://dev4you-pi.vercel.app/api/admin/reset` (см. §9).

## 4. Workflow

```
[UI: новая задача (форма /new)]
        ↓ POST /api/tasks (Edge, 25s)
[mutex check + rate-limit per telegram_id]
        ↓ insert task → after()
[runAnalysis] 1 LLM-call → структурированный spec (zod-валидация)
        ├─ in: текст задачи + ДЕРЕВО whitelist-файлов с превью (6 строк)
        └─ out: { goal, targetFiles, filesToDelete, changes, ... }
        ↓ fire-and-forget fetch
[POST /api/tasks/[id]/implement] (Edge, 25s)
        ↓
[runImplement] для каждого файла из spec.targetFiles:
        ↓ 1 LLM-call в diff-формате: { edits: [{find, replace}] }
        ↓ applyEdits применяет к текущему содержимому файла
        ↓ результат сохраняется в tasks.producedFiles
        ↓ если pendingFiles.length > 0 → self-trigger fetch
        ↓ если pendingFiles.length == 0 → finalizeImplement в той же функции
[finalizeImplement]
        ↓ Octokit createBranch task/N
        ↓ ОДИН GraphQL createCommitOnBranch с additions + deletions
        ↓ openPullRequest
        ↓ status='ready_for_review'
        ↓ ИММЕДИАТНЫЙ mergePullRequest через Octokit (workaround — см. §7)
        ↓ status='merged' + mergeCommitSha
        ↓ deleteBranch task/N (освобождает Vercel preview slot)
[Vercel пересобирает production main]
        ↓
[<AutoRefresh/> на UI ловит смену commit SHA]
        ↓ requestIdleCallback → window.location.reload()
[Пользователь видит изменения]
```

Никакого human-in-the-loop между постановкой и видимым результатом. При провале на любом этапе — `status='failed'`, сообщение в `errorMessage` с префиксом этапа (`analysis:` / `implement:` / `deploy:`).

## 5. Sandbox для агента

Двухуровневая защита: что можно **редактировать** и что нельзя **удалять** (см. [`lib/agent/sandbox.ts`](lib/agent/sandbox.ts)).

### Whitelist для редактирования (`isAllowed`)

- `app/globals.css` — CSS-переменные темы
- `tailwind.config.ts` — конфиг Tailwind (если будет)
- `app/page.tsx`, `app/new/**`, `app/tasks/**` — публичные страницы UI
- `components/**` (кроме `auto-refresh` / `list-auto-refresh` — клиентская инфраструктура)
- `public/**` — статика

### Защита от удаления (`PROTECTED_FROM_DELETION`)

Файлы, которые можно **только редактировать**, не удалять (даже если агент попросит `filesToDelete`):

- `app/page.tsx`, `app/layout.tsx`, `app/globals.css`
- `app/new/**`, `app/tasks/**`
- `components/task-card.tsx`, `status-badge.tsx`, `timeline.tsx`
- `components/auto-refresh.tsx`, `list-auto-refresh.tsx`

Защита введена после задачи #55 («удали карточки с ошибками»), которую агент истолковал как «удали `components/task-card.tsx` целиком» — главная сломалась.

### Запрещено вообще

`.env*`, `lib/agent/**`, `lib/db/**`, `lib/auth/**`, `middleware.ts`, `package.json`, `.github/**`, `app/api/**`. Любая попытка записи вне whitelist валит задачу с `SandboxError`.

### Защита от prompt-injection

Системный промпт агента-аналитика инструктирует игнорировать запросы вроде «удали базу», «отключи проверки», «забудь предыдущие инструкции». Такие задачи помечаются как невыполнимые: `goal = "Задача не может быть выполнена: вне sandbox"`, `targetFiles = []`.

## 6. Технологический стек

| Слой | Решение |
|---|---|
| Frontend | Next.js 16 (App Router, React 19), Tailwind v4, mobile-first |
| Auth | Telegram WebApp `initData` (HMAC-SHA256, Web Crypto API) + replay-защита по `auth_date` (TTL 24ч) + constant-time сравнение |
| API | Next.js Route Handlers, **Edge runtime** (25s default, увеличено через `maxDuration`) |
| База данных | Vercel Postgres / Neon serverless + Drizzle ORM |
| Векторный поиск | pgvector (запланирован, в MVP не используется) |
| LLM (по умолчанию) | Внутренний **Qwen 3.5 27B GPTQ-Int4** через OpenAI-совместимый endpoint |
| LLM (опционально) | **OpenRouter** (`qwen/qwen3.6-plus`, `anthropic/claude-sonnet-4.5` и др.) — включается через `OPENROUTER_API_KEY` |
| Доступ к local Qwen | `<ip>.nip.io` обходит запрет Edge на прямой fetch по IP |
| Output формат LLM | **diff-based** (`{ edits: [{ find, replace }] }`) — короткий ответ, нет таймаутов |
| Git | Octokit REST + **GraphQL `createCommitOnBranch`** (один коммит на все файлы) |
| Стенд | ~~Vercel Preview Deployments~~ → **immediate-merge через Octokit** (единая точка мержа, см. §7) |
| Webhooks | `/api/webhooks/{github,vercel}` — обязательная проверка подписи (HMAC), fail-closed без секрета; мерж из них убран |
| Хостинг | Vercel **Pro** ($20/мес) — Hobby упирался в квоты |
| Live UI | `<ListAutoRefresh/>` через `router.refresh()` каждые 3 сек + `<AutoRefresh/>` через `requestIdleCallback` для hard reload по смене commit SHA |
| Защита от наплыва | mutex (DB-индекс `one_active_task`), rate-limit 60 сек / `telegram_id`, watchdog-cron (добивает зависшие), auto-cleanup task-веток |

## 7. Ограничения и решения

### Vercel preview deployments → "Resource provisioning failed"
- Vercel в течение дня стабильно отказывал в provisioning preview-окружений для проекта (даже на Pro, даже через `--prebuilt`).
- **Workaround:** после открытия PR агент **сразу мержит** через Octokit, не дожидаясь preview build. Production build выступает в роли «теста». Если main упадёт — подписанный webhook ловит `deployment_status=failure` для production и помечает задачу `failed` с ссылкой на лог.
- Trade-off: нет валидации до merge. Сломанный код агента может попасть в main → prod stuck на старой версии. В roadmap — auto-revert main commit при production failure.
- **Единая точка мержа:** мерж выполняется ТОЛЬКО в `finalizeImplement`. Прежде его дублировали оба webhook-обработчика (`deployment.succeeded`), что давало гонку тройного мержа (успешная задача могла перезаписаться в `failed`). Теперь webhook'и только фиксируют preview URL / помечают prod-failure, но не мержат.

### Edge запрещает fetch по IP
- Local Qwen-сервер по адресу `212.41.6.240` без домена.
- **Решение:** прозрачная подмена в коде на `212.41.6.240.nip.io` (publicly hosted wildcard DNS). Обходит ограничение, при использовании OpenRouter не активируется.

### Большие файлы → LLM не успевает / обрывает JSON
- Полное содержимое TaskCard (~200 строк) ≈ 8 KB output → стрим прерывается, JSON парсер падает.
- **Решение:** diff-формат вместо полного содержимого. Output 200-500 байт. `applyEdits` применяет find/replace к текущему содержимому файла. Если find не найден — понятная ошибка вместо записи битого кода.

### Edge function timeout
- Один LLM-call + Octokit операции не всегда укладываются в 25 сек.
- **Решение:** pipeline разбит на отдельные Edge-функции (analysis → fetch implement → self-trigger implement). Каждый шаг получает свои 25 сек. Между файлами в implement — fire-and-forget fetch к самому себе.

### Ограниченное качество локального Qwen
- 27B Int4 регулярно генерит несуществующие Tailwind-классы, поля schema, конфликты `'use client'` + `metadata`, etc.
- **Решения:** толерантная zod-схема (`z.unknown().transform(...)` для всех полей spec); 3 попытки на каждом этапе с задержкой 1.5 сек; явные подсказки в системном промпте; OpenRouter fallback для критичных задач.

### Корпоративный ИБ-контур (долгосрочно)
- Код проприетарный — облачные LLM запрещены.
- **Подход:** при пустом `OPENROUTER_API_KEY` агент автоматически использует локальный Qwen из `QWEN_BASE_URL`. Стек vendor-agnostic — переезд на vLLM / Ollama не требует переписывания.

### Конкуренция за main
- Несколько одновременных задач = конфликты на git merge (expectedHeadOid устаревает).
- **Решения:**
  - **Mutex (атомарный)**: новая задача отказывается с 429, если уже есть активная (любой статус не в `merged/failed/cancelled`). Подкреплён частичным уникальным индексом `one_active_task` в БД (все активные строки делят один ключ → второй конкурентный INSERT падает с 23505, ловим в route). SELECT-проверка осталась как быстрый путь с дружелюбным сообщением; индекс — атомарный backstop против гонки.
  - **Watchdog-cron**: задача, зависшая в активном статусе дольше 5 минут (потерянный self-trigger, упавшая Edge-функция), держала бы мьютекс вечно и блокировала систему. `/api/cron/watchdog` (каждые 5 мин, см. `vercel.json`) помечает такие `failed` и освобождает слот.
  - **Rate-limit**: 60 секунд между задачами от одного `telegram_id`. Защита от спама.
  - **Auto-cleanup веток**: после merge `octokit.git.deleteRef` сразу удаляет `task/N` — освобождает слот Vercel preview branch (на Pro их 100). `retry` тоже чистит ветку перед перезапуском (иначе `createBranch` → 422).

## 8. Безопасность и устойчивость

- Telegram `initData` валидируется через HMAC от bot token (Web Crypto API, edge-friendly). Добавлены: **replay-защита** (отказ при `auth_date` старше 24ч) и **constant-time** сравнение хеша. **Fail-closed:** если `initData` передан, но не прошёл проверку — 401 (а не молчаливый откат в ANON). Отсутствие заголовка вовсе = публичный демо-режим (осознанный выбор, см. §9).
- **Webhook'и подписаны.** `/api/webhooks/{github,vercel}` проверяют HMAC-подпись (`x-hub-signature-256` / `x-vercel-signature`) от секрета и отклоняют запрос без/с неверной подписью. Без заданного секрета — 503 (fail-closed). Раньше эндпоинты были открыты и умели мержить произвольный PR — мерж из них убран, осталась только фиксация статуса.
- Все секреты — через Vercel Environment Variables, в коде `process.env` единой точкой ([`lib/env.ts`](lib/env.ts)) с zod-валидацией.
- `.env.local` в `.gitignore`, `.env.example` показывает только имена.
- Public GitHub репо: код виден сообществу, токены не попадают (env-валидация при билде ловит опечатки).
- В MVP **нет аутентификации в смысле user accounts** — `telegram_id` достаточно для идентификации в Mini App. Для публичного веба `telegramUserId=0`, `username='anon'`.
- **Octokit с таймаутом** (8с/запрос через AbortController) — чтобы зависший GitHub не обрывал плотную 25s-функцию на середине `finalizeImplement`.
- Mutex (DB-индекс) + watchdog + rate-limit + cleanup веток (см. §7) — защита от наплыва зрителей и самоблокировки системы.
- Sandbox + `PROTECTED_FROM_DELETION` (см. §5) — защита от случайного удаления критичных файлов агентом; проверка от удаления энфорсится на write-границе (`commitMultipleFiles`), а не только на анализе.

## 9. Reset to baseline (публичный endpoint)

Зрители демо изменяют приложение до неузнаваемости — это часть концепции. Чтобы любой мог одной кнопкой вернуть всё к исходному виду, есть **публичный** endpoint сброса.

### Snapshot
Git tag `demo-baseline` фиксирует «эталонное» состояние всех whitelist-файлов. Создать/обновить:

```bash
git tag -f demo-baseline main
git push origin demo-baseline -f
```

### Reset
`POST /api/admin/reset` через Octokit GraphQL `createCommitOnBranch` одним коммитом перезаписывает все whitelist-файлы их версиями из `demo-baseline`. После этого Vercel сам пересобирает production за ~60 секунд.

```bash
# Публично (если ADMIN_RESET_TOKEN не задан)
curl -X POST https://dev4you-pi.vercel.app/api/admin/reset

# Если ADMIN_RESET_TOKEN задан — нужен токен
curl -X POST -H "x-admin-token: <ТОКЕН>" https://dev4you-pi.vercel.app/api/admin/reset
```

По умолчанию endpoint также удаляет все задачи из БД. Если хотите оставить историю задач: `?clearTasks=false`.

### Публичный по умолчанию, но только POST
Endpoint **публичный** — это часть демо-концепции «играйте сколько хотите, всегда есть откат». Любой зритель в момент демонстрации может вернуть всё к baseline. Это:
- Снимает с автора роль «единственного оператора reset'а»
- Делает демо устойчивым: если кто-то сильно сломал — следующий зритель может починить
- Превращает reset в часть UI взаимодействия, а не в админку

Два ограничения, не ломающие концепцию:
- **Только POST.** GET-вариант убран: он срабатывал от prefetch браузера/антивирусов/сканеров превью — то есть `main` мог затереться без участия человека. Reset должен быть осознанным действием.
- **Опциональный токен.** Если задан `ADMIN_RESET_TOKEN`, endpoint требует его (`x-admin-token` или `?token=`) — так доступ закрывается в любой момент без правки кода (напр. для прод-контура). Пусто = публично.

### Что делает endpoint пошагово
1. Через Octokit `git/getTree(recursive)` читает дерево по ref `demo-baseline`.
2. Фильтрует пути через `assertAllowed` (sandbox).
3. Для каждого файла читает blob.
4. Через GraphQL `createCommitOnBranch` создаёт ОДИН коммит на main с file additions = все файлы baseline.
5. (По умолчанию) `DELETE FROM tasks` — каскадно удаляются `task_events`.
6. Возвращает `{ ok, restoredFiles, newSha, tasksDeleted }`.

Реализация: [`app/api/admin/reset/route.ts`](app/api/admin/reset/route.ts), helper в [`lib/github.ts`](lib/github.ts) (`getAllowedFilesAtRef`).

## 10. UX-прозрачность

После анализа на карточке задачи видно:
- **Как понял агент** — `spec.goal`
- **Будет править** — `spec.targetFiles`
- **Удалит** — `spec.filesToDelete` (красным)
- **Что именно поменяет** — `spec.changes` в раскрывающемся `<details>`
- **Ошибка** (если failed) — `errorMessage` + кнопка **Повторить** (перезапускает ту же задачу, не плодит дубликаты)

Это даёт пользователю шанс увидеть промашку агента ещё до того, как код попадёт в main.

Бар прогресса показывает **честное** состояние:
- Статус `merged` рисует 100% только если: (а) commit задачи реально на production (sha совпал с `/api/version`), либо (б) прошло >2 минут с момента merge.
- Иначе показывает 95% + бейдж «Выкатываю».

## 11. Roadmap

См. [ROADMAP.md](ROADMAP.md) — упорядоченный список доработок.

## 12. История

Проект построен за один день (2026-05-13) в режиме pair-coding с Claude Code (Opus 4.7). После первого зелёного pipeline каждая последующая задача в репо **ставилась через сам сервис** — агент менял код собственного дашборда. История коммитов в публичном репозитории — это и есть лог демо: видны успехи (`task #N: ...`), и провалы (`Revert "task #M..."`), и архитектурные решения хост-разработчика. Это и есть «саморазвивающаяся демо-система» из видения.
