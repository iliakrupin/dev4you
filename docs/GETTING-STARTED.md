# Быстрый старт — КручуФичу (`dev4you`)

## Требования

- **pnpm** (в CI используется pnpm 10) и **Node.js** (в CI — Node 24).
- **Postgres** — Vercel Postgres / Neon (serverless-драйвер `@neondatabase/serverless`); локально
  подойдёт любой совместимый Postgres через `DATABASE_URL`.
- **Telegram-бот** — токен от [@BotFather](https://t.me/BotFather) (`/newbot` или `/token`).
- **GitHub fine-grained PAT** на репозиторий с правами: `Contents: write`,
  `Pull requests: write`, `Metadata: read` — https://github.com/settings/personal-access-tokens.
- **LLM-эндпоинт** — либо внутренний Qwen (OpenAI-совместимый, `QWEN_BASE_URL`), либо API-ключ
  OpenRouter (`OPENROUTER_API_KEY`).

Полный список переменных и дефолты — [docs/CONFIGURATION.md](CONFIGURATION.md).

## Установка

```bash
git clone https://github.com/iliakrupin/dev4you && cd dev4you
pnpm install
cp .env.example .env.local   # заполнить значения
```

Обязательные переменные `.env.local`: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_BOT_USERNAME`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `QWEN_BASE_URL`,
`QWEN_MODEL`, `NEXT_PUBLIC_APP_URL` (`QWEN_API_KEY` можно оставить `dummy`, если эндпоинт не
требует ключ; `GITHUB_BASE_BRANCH` по умолчанию `main`).

Создать таблицы в БД (команда также применяет частичный уникальный индекс `one_active_task` —
без него мьютекс не атомарен):

```bash
pnpm db:push
```

## Первый запуск

```bash
pnpm dev                     # http://localhost:3000
```

1. Откройте `http://localhost:3000` — список задач (для проверки API: `curl
   http://localhost:3000/api/health` → `{"ok":true,…}`).
2. Поставьте задачу через форму `/new` (например, «сделай акцентный цвет красным»).
3. Следите за статусами на карточке: `analyzing → analyzed → implementing → ready_for_review →
   merged`. После merge агент пересоберёт `main` — в проде Vercel сам перерисует приложение.
4. В Telegram Mini App приложение подключается через `@BotFather` → `/newapp` → URL приложения.

## Типичные проблемы первого запуска

| Симптом | Причина и что делать |
|---|---|
| `Invalid environment variables` при старте/билде | Не заполнен или невалиден `.env.local`. T3 Env валидирует переменные через `lib/env.ts`; точная причина — в выводе выше сообщения |
| `pnpm db:push` падает | Не задан `DATABASE_URL` или БД недоступна. Drizzle читает `.env.local`, затем `.env` (первый перекрывает) |
| 429 «Сейчас в работе задача #N» | Мьютекс «одна активная задача». Дождитесь завершения; зависшая задача будет добита watchdog'ом через 5 минут |
| 429 «Слишком часто. Подождите N сек» | Rate-limit: 60 секунд между задачами от одного `telegram_id` |
| LLM отвечает пустотой / «LLM не вернул валидный JSON» | Проверьте `QWEN_BASE_URL`/`QWEN_MODEL` (`curl $QWEN_BASE_URL/models`); либо подключите OpenRouter через `OPENROUTER_API_KEY` |
| `Путь "…" вне sandbox` (SandboxError) | Агент выбрал файл вне whitelist — ожидаемая защита, а не баг |
| Webhook-эндпоинт отвечает 503 | Не задан соответствующий секрет (`GITHUB_WEBHOOK_SECRET` / `VERCEL_WEBHOOK_SECRET`) — fail-closed |
| Reset отвечает 401 | Задан `ADMIN_RESET_TOKEN` — передайте его в `x-admin-token` или `?token=` |
| Reset: «В tag demo-baseline нет whitelist-файлов» | Нет git-тега `demo-baseline` в репозитории — создайте (см. docs/SPEC.md §9) |

## Куда дальше

- [docs/CONFIGURATION.md](CONFIGURATION.md) — все переменные окружения, секреты, окружения.
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — как устроен пайплайн и sandbox.
- [docs/DEVELOPMENT.md](DEVELOPMENT.md) — команды, стиль кода, Drizzle-миграции, CI.
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — деплой на Vercel и настройка webhooks/cron.
