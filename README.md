# КручуФичу (`dev4you`)

> Поставил задачу — получил фичу. Аналитик без разработчиков.

Multi-agent демо-система: пользователь описывает фичу (например, «сделай акцентный цвет красным») в Telegram Mini App — AI-агент формализует задачу, пишет код, открывает PR, ждёт сборку preview-стенда от Vercel и автоматически мерджит в `main`. Приложение перерисовывает само себя.

## Стек

- **Next.js 16** App Router (TypeScript, React 19, Tailwind v4)
- **Vercel Postgres / Neon** + **Drizzle ORM**
- **OpenAI SDK** → внутренний **Qwen 3.5 27B** (OpenAI-совместимый endpoint)
- **Octokit REST** для git-операций (ветки, PR, мерджи)
- **Telegram Mini App** + HMAC-валидация `initData` (с replay-защитой по `auth_date`)
- Деплой на **Vercel Pro**. Пайплайн-роуты — **Edge runtime, `maxDuration = 25`** (а не 10s, как на nodejs/Hobby); pipeline разрезан на короткие шаги

## Архитектура одного запуска

```
[Mini App: новая задача]
        ↓ POST /api/tasks  (mutex + rate-limit)
[insert task → after()]
        ↓
[runAnalysis]  — 1 LLM call → spec JSON
        ↓
[runImplement] — 1 LLM call → новое содержимое файлов из whitelist
        ↓ Octokit: branch + commit + PR
[finalizeImplement] — ИММЕДИАТНЫЙ merge через Octokit (единая точка мержа)
        ↓ main обновлён, Vercel пересобирает production
[подписанный webhook deployment_status] — если prod build упал, задача → failed
        ↓
[watchdog cron] — добивает задачи, зависшие на любом этапе
```

> Preview-стенд Vercel сейчас отключён workaround'ом (provisioning issue) — мерж
> выполняется сразу, роль «теста» играет production build. Подробности — [SPEC §7](SPEC.md).

## Sandbox

Агент имеет право менять только перечень файлов из whitelist (см. [`lib/agent/sandbox.ts`](lib/agent/sandbox.ts)) — в первую очередь `app/globals.css` и `tailwind.config.ts`. Любая попытка записи вне whitelist падает с `SandboxError`. Системные промпты содержат защиту от prompt-injection.

## Локальная разработка

```bash
pnpm install
cp .env.example .env.local   # заполнить секреты
pnpm db:push                 # создать таблицы в Postgres
pnpm dev
```

Подробности по переменным окружения — в [`.env.example`](.env.example).

## Деплой

Проект разворачивается на Vercel + Vercel Postgres. После создания проекта в Vercel:
1. Подключите Vercel Postgres (Storage → Create Database).
2. Заполните остальные env vars из `.env.example`. Для активной защиты задайте секреты:
   - `GITHUB_WEBHOOK_SECRET` / `VERCEL_WEBHOOK_SECRET` — без них соответствующие
     webhook-эндпоинты отвечают 503 (fail-closed по подписи).
   - `CRON_SECRET` — для watchdog-cron (Vercel сам шлёт `Authorization: Bearer`).
   - `ADMIN_RESET_TOKEN` — опционально; если задан, reset требует токен (иначе публичный).
3. Запустите `pnpm db:push` локально с production `DATABASE_URL` — создаёт таблицы
   **и** частичный уникальный индекс `one_active_task` (атомарный мьютекс).
4. Настройте webhook'и (с теми же секретами, что в env):
   - Vercel → Webhooks на `/api/webhooks/vercel`, события `deployment.created/succeeded/error`.
   - GitHub repo → Webhooks на `/api/webhooks/github`, событие `Deployment statuses`.
5. Watchdog-cron (`/api/cron/watchdog`, каждые 5 мин) подключается автоматически из [`vercel.json`](vercel.json).
6. У `@BotFather` в Telegram: `/newapp` → URL = `https://<ваш-домен>`.

## Документация

- [SPEC.md](SPEC.md) — полная спецификация: видение, аудитория, архитектура, ограничения.
- [ROADMAP.md](ROADMAP.md) — план доработок поверх MVP с приоритетами.

## Сбросить демо к исходному виду

Любой может одной командой вернуть приложение к baseline (если зрители его сильно изменили):

```bash
curl -X POST https://dev4you-pi.vercel.app/api/admin/reset
# если задан ADMIN_RESET_TOKEN:
curl -X POST -H "x-admin-token: <ТОКЕН>" https://dev4you-pi.vercel.app/api/admin/reset
```

Endpoint публичный по умолчанию — это часть демо-концепции «играйте сколько хотите, всегда есть откат». Только **POST** (GET убран — он срабатывал от prefetch/сканеров и мог случайно затереть `main`). При заданном `ADMIN_RESET_TOKEN` требует токен. Через ~60 секунд после Vercel-пересборки приложение полностью в исходном состоянии. Подробности в [SPEC.md §9](SPEC.md#9-reset-to-baseline-публичный-endpoint).

## Лицензия

MIT.
