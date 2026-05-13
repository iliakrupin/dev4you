# ФичуЗадачу (`dev4you`)

> Поставил задачу — получил фичу. Аналитик без разработчиков.

Multi-agent демо-система: пользователь описывает фичу (например, «сделай акцентный цвет красным») в Telegram Mini App — AI-агент формализует задачу, пишет код, открывает PR, ждёт сборку preview-стенда от Vercel и автоматически мерджит в `main`. Приложение перерисовывает само себя.

## Стек

- **Next.js 16** App Router (TypeScript, React 19, Tailwind v4)
- **Vercel Postgres / Neon** + **Drizzle ORM**
- **OpenAI SDK** → внутренний **Qwen 3.5 27B** (OpenAI-совместимый endpoint)
- **Octokit REST** для git-операций (ветки, PR, мерджи)
- **Telegram Mini App** + HMAC-валидация `initData`
- Деплой на **Vercel Hobby** (10 s serverless timeout — pipeline разрезан на короткие шаги)

## Архитектура одного запуска

```
[Mini App: новая задача]
        ↓ POST /api/tasks
[insert task → after()]
        ↓
[runAnalysis]  — 1 LLM call → spec JSON
        ↓
[runImplement] — 1 LLM call → новое содержимое файлов из whitelist
        ↓ Octokit: branch + commit + PR
[Vercel собирает preview]
        ↓ webhook deployment.succeeded
[авто-merge PR через Octokit] — main обновлён, продакшен перерисовывается
```

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
2. Заполните остальные env vars из `.env.example`.
3. Запустите `pnpm db:push` локально с production `DATABASE_URL`, чтобы создать таблицы.
4. Настройте Vercel webhook на `https://<ваш-домен>/api/webhooks/vercel` с событиями `deployment.created`, `deployment.succeeded`, `deployment.error`.
5. У `@BotFather` в Telegram: `/newapp` → URL = `https://<ваш-домен>`.

## Документация

- [SPEC.md](SPEC.md) — полная спецификация: видение, аудитория, архитектура, ограничения.
- [ROADMAP.md](ROADMAP.md) — план доработок поверх MVP с приоритетами.

## Сбросить демо к исходному виду

Любой может одной командой вернуть приложение к baseline (если зрители его сильно изменили):

```bash
curl -X POST https://dev4you-pi.vercel.app/api/admin/reset
```

Или просто открыть https://dev4you-pi.vercel.app/api/admin/reset в браузере. Endpoint публичный — намеренно. Через ~60 секунд после Vercel-пересборки приложение полностью в исходном состоянии. Подробности в [SPEC.md §9](SPEC.md#9-reset-to-baseline-публичный-endpoint).

## Лицензия

MIT.
