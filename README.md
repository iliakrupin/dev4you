# КручуФичу (`dev4you`)

> Поставил задачу — получил фичу. Аналитик без разработчиков.

Multi-agent демо-система: пользователь описывает фичу (например, «сделай акцентный цвет красным»)
в Telegram Mini App — AI-агент формализует задачу, пишет код, открывает PR и автоматически
мерджит в `main`. Vercel пересобирает production — приложение перерисовывает само себя. Проект
работает над собственным кодом: история коммитов публичного репозитория — это и есть лог демо.

## Статус

На 2026-09-06:

- Работает сквозной пайплайн: анализ (1 LLM-вызов → spec JSON) → implement (LLM-диффы
  whitelist-файлов, по файлу за вызов) → ветка `task/N` + один GraphQL-коммит + PR через Octokit →
  immediate-merge → production-сборка Vercel.
- Preview-стенд Vercel отключён workaround'ом (provisioning issue): мерж выполняется сразу, роль
  «теста» играет production build; упавший prod build ловит подписанный webhook — задача идёт в
  `failed`.
- Устойчивость: атомарный мьютекс «одна активная задача» (partial unique index `one_active_task`),
  rate-limit 60 c на `telegram_id`, watchdog-cron каждые 5 минут, подписанные webhook'и
  (fail-closed), POST-only reset с опциональным токеном, sandbox + защита от prompt-injection.
- Не сделано — см. [docs/ROADMAP.md](docs/ROADMAP.md): auto-revert main при prod-failure, очередь
  вместо 429, тёмная/светлая тема Telegram и др.

## Быстрый старт

```bash
pnpm install
cp .env.example .env.local   # заполнить секреты (см. docs/CONFIGURATION.md)
pnpm db:push                 # создать таблицы + индекс-мьютекс one_active_task
pnpm dev                     # http://localhost:3000
```

Минимум для локального запуска: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
`GITHUB_TOKEN`, `QWEN_BASE_URL`, `QWEN_MODEL`, `NEXT_PUBLIC_APP_URL`. Подробный walkthrough —
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

## Архитектура (кратко)

```
[Mini App: новая задача]
      ↓ POST /api/tasks  (авторизация Telegram + mutex + rate-limit)
[insert task → after()] → [runAnalysis] 1 LLM-вызов → spec JSON
      ↓ fire-and-forget POST /api/tasks/[id]/implement
[runImplement] по одному файлу за вызов: LLM → diff-правки из whitelist
      ↓ [finalizeImplement] Octokit: branch task/N + коммит + PR
[immediate-merge (squash)] → main обновлён → Vercel пересобирает production
      ↓ подписанный webhook deployment_status: упавший prod → задача failed
[watchdog cron /api/cron/watchdog] — добивает задачи, зависшие > 5 минут
```

- Стек: Next.js 16 App Router (React 19, Tailwind v4), Vercel Postgres / Neon + Drizzle ORM,
  OpenAI SDK → Qwen 3.5 27B (OpenAI-совместимый endpoint) или OpenRouter, Octokit REST + GraphQL.
- Пайплайн-роуты — Edge runtime, `maxDuration = 25`; пайплайн разрезан на шаги по одному
  LLM-вызову. Webhooks/reset/cron — nodejs runtime.
- Sandbox: агент меняет только whitelist-файлы ([`lib/agent/sandbox.ts`](lib/agent/sandbox.ts)),
  запись вне списка падает с `SandboxError`; структурно важные файлы защищены от удаления;
  системные промпты содержат защиту от prompt-injection.
- Подробности — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Карта документации

| Документ | О чём |
|---|---|
| [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) | Требования, установка, первый запуск, типичные проблемы |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Компоненты, жизненный цикл задачи, подсистемы, схема данных |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Все переменные окружения: назначение, дефолты, секреты |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Команды, стиль кода, Drizzle-миграции, CI |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Деплой на Vercel, webhooks, cron, наблюдаемость, откат |
| [docs/SPEC.md](docs/SPEC.md) | Полная спецификация: видение, аудитория, ограничения, решения |
| [docs/ROADMAP.md](docs/ROADMAP.md) | План доработок поверх MVP с приоритетами |
| [AGENTS.md](AGENTS.md) | Правила для кодинг-агентов (стек, конвенции, sandbox) |

## Структура репозитория

```
app/
  api/…               # Route Handlers: tasks, webhooks/{github,vercel}, admin/reset, cron/watchdog
  new/, tasks/        # страницы Mini App (форма задачи; детальный экран редиректит на главную)
  page.tsx            # главная: список задач, перерисовывается сама
components/           # UI: task-card, timeline, status-badge, auto-refresh, theme-switcher…
lib/
  agent/              # пайплайн агента: runner.ts, prompts.ts, llm.ts, sandbox.ts
  db/                 # Drizzle-схема (tasks, task_events) и клиент
  github.ts           # Octokit: ветки, GraphQL-коммиты, PR, squash-merge, удаление веток
  telegram.ts         # HMAC-валидация initData + replay-защита
  env.ts              # единственная точка чтения process.env (T3 Env + zod)
docs/                 # документация проекта
```

## Сброс демо к baseline

```bash
curl -X POST https://dev4you-pi.vercel.app/api/admin/reset
# если задан ADMIN_RESET_TOKEN:
curl -X POST -H "x-admin-token: <ТОКЕН>" https://dev4you-pi.vercel.app/api/admin/reset
```

Endpoint публичный по умолчанию (часть демо-концепции «всегда есть откат»), только **POST**;
при заданном `ADMIN_RESET_TOKEN` требует токен. Перезаписывает whitelist-файлы версиями из
git-тега `demo-baseline` и чистит задачи. Подробности — [docs/SPEC.md §9](docs/SPEC.md).

## Лицензия

MIT.
