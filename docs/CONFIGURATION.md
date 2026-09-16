# Конфигурация — КручуФичу (`dev4you`)

## Где живут настройки

- **`.env.local`** — локальная разработка (в `.gitignore`, не коммитится). Шаблон —
  [`.env.example`](../.env.example). Drizzle (`drizzle.config.ts`) читает `.env.local`, затем
  `.env` (первый перекрывает).
- **Vercel Environment Variables** — production/preview окружения на Vercel.
- **[`lib/env.ts`](../lib/env.ts)** — единственная точка чтения `process.env` в коде (T3 Env +
  zod). Ошибка валидации при билде падает с читаемым списком проблем; для preview/development
  Vercel-окружений и при `SKIP_ENV_VALIDATION=true` валидация пропускается (секреты с галочкой
  «только Production» не должны ронять PR-сборку).
- **GitLab CI/CD Variables** — masked `WATCHDOG_TOKEN` для schedule-job; сам токен не хранится
  ни в Git, ни в Vercel.
- **`.gitlab-ci.yml`** — проверки приложения, DevSecOps-фазы и schedule-job watchdog.

## Переменные окружения

### Обязательные (без них env-валидация валит билд)

| Переменная | Назначение | Дефолт |
|---|---|---|
| `DATABASE_URL` | Строка подключения к Vercel Postgres / Neon | — |
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather (для HMAC-валидации initData) | — |
| `TELEGRAM_BOT_USERNAME` | Username бота без `@` | — |
| `GITHUB_TOKEN` | Fine-grained PAT: Contents write, Pull requests write, Metadata read | — |
| `GITHUB_OWNER` | Владелец репозитория, над которым работает агент | `iliakrupin` в `.env.example` |
| `GITHUB_REPO` | Имя репозитория | `dev4you` в `.env.example` |
| `QWEN_BASE_URL` | OpenAI-совместимый endpoint LLM (IP-адреса автоматически обходятся через `<ip>.nip.io` для Edge) | — |
| `QWEN_MODEL` | Имя модели (проверить: `curl $QWEN_BASE_URL/models`) | `Qwen/Qwen3.5-27B-GPTQ-Int4` как fallback в коде |
| `NEXT_PUBLIC_APP_URL` | Публичный URL приложения (для self-trigger между шагами пайплайна) | `http://localhost:3000` в `.env.example` |

С дефолтом в валидации: `GITHUB_BASE_BRANCH` (default `main`), `QWEN_API_KEY` (default `dummy` —
заполнять, только если эндпоинт требует ключ).

### Опциональные

| Переменная | Назначение | Дефолт |
|---|---|---|
| `OPENROUTER_API_KEY` | Если задан — агент идёт через OpenRouter вместо локального Qwen. Для корп-контура с проприетарным кодом НЕ задавать | не задан |
| `OPENROUTER_BASE_URL` | Endpoint OpenRouter | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | Модель OpenRouter | `qwen/qwen3.6-plus` (fallback в коде) |
| `GITHUB_WEBHOOK_SECRET` | Секрет подписи webhook'а GitHub. Без него `/api/webhooks/github` отвечает 503 (fail-closed) | не задан |
| `VERCEL_WEBHOOK_SECRET` | Signing secret webhook'а Vercel. Без него `/api/webhooks/vercel` отвечает 503 | не задан |
| `ADMIN_RESET_TOKEN` | Если задан — `/api/admin/reset` требует токен (`x-admin-token` или `?token=`); пусто = публичный POST | не задан |
| `SKIP_ENV_VALIDATION` | `true` — пропустить env-валидацию (используется в CI) | не задан |

## Обязательное и необязательное — минимум для запуска

- **Локально работающий пайплайн**: блок «Обязательные» выше. Секреты webhook'ов
  (`*_WEBHOOK_SECRET`) локально не нужны — без них соответствующие эндпоинты отвечают 503.
- **Полноценный прод**: + секреты webhook'ов из таблицы опциональных; `WATCHDOG_TOKEN` хранится
  отдельно как masked variable проекта GitLab, иначе schedule-job не сможет вызвать watchdog.

## Секреты

- Секреты приложения — через env (`Vercel Environment Variables` / `.env.local`) и читаются
  через `lib/env.ts`. `WATCHDOG_TOKEN` живёт только в masked variables GitLab; в коде хранится
  лишь его SHA-256 для constant-time проверки.
- `.env.local` в `.gitignore`; `.env.example` содержит только имена и комментарии.
- `TELEGRAM_BOT_TOKEN` критичен: им подписывается initData — утечка позволяет подделывать
  авторизацию.

## Различия по окружениям

| Окружение | Особенности |
|---|---|
| Production (Vercel) | Полный набор env; env-валидация на билде обязательна; `NEXT_PUBLIC_APP_URL` = домен приложения |
| Preview (Vercel) | Env-валидация скипается (`VERCEL_ENV=preview` в `lib/env.ts`) — PR-сборка не падает из-за секретов «только Production» |
| CI | `SKIP_ENV_VALIDATION=true pnpm build` — сборка без реальных секретов |
| Локально | `.env.local`; `pnpm dev`; валидация выполняется |

## Проверка конфига

```bash
pnpm exec tsc --noEmit && SKIP_ENV_VALIDATION=true pnpm build   # так делает CI
pnpm dev                                                        # env-валидация на старте
curl http://localhost:3000/api/health                           # {"ok":true,…}
```

Ошибки валидации печатаются списком (`путь: сообщение`) с завершающим
`Invalid environment variables — см. логи выше`.

## Куда дальше

- [docs/GETTING-STARTED.md](GETTING-STARTED.md) — пошаговый первый запуск.
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — настройка env на Vercel, webhooks, cron.
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — как переменные используются в подсистемах.
