# Деплой и эксплуатация — КручуФичу (`dev4you`)

## Цель

Приложение деплоится на **Vercel** с базой **Vercel Postgres / Neon**. Сборку и проверки
дополнительно выполняет собственный GitLab Runner на SER8. Пайплайн-роуты работают в Edge
runtime с `maxDuration = 25`; webhooks/reset/watchdog — nodejs (30–60 c). Источник истины —
`export const runtime` / `export const maxDuration` в каждом route.

Preview-стенды Vercel сейчас отключены workaround'ом (provisioning issue «Resource provisioning
failed», даже на Pro): агент мержит PR сразу, роль «теста» играет production build —
docs/SPEC.md §7.

## Окружения

| Окружение | Что нужно |
|---|---|
| Production (ветка `main`) | Все переменные приложения из docs/CONFIGURATION.md, включая секреты webhook'ов |
| Preview | Env-валидация скипается (`lib/env.ts`), но preview-деплой для task-веток фактически не используется (см. workaround) |
| Локально | `.env.local` + `pnpm db:push` против той же или личной БД |

## Первый деплой (пошагово)

1. Создайте проект на Vercel из репозитория (framework определится как Next.js).
2. Подключите Vercel Postgres: Storage → Create Database — переменная `DATABASE_URL` появится
   автоматически.
3. Заполните остальные переменные окружения по docs/CONFIGURATION.md. Обязательные секреты для
   активной защиты: `GITHUB_WEBHOOK_SECRET`, `VERCEL_WEBHOOK_SECRET` (без них webhook-эндпоинты
   отвечают 503), `ADMIN_RESET_TOKEN`
   (опционально; задан — reset требует токен).
4. Примените схему к production-БД локально: `pnpm db:push` с production `DATABASE_URL` —
   создаёт таблицы **и** индекс `one_active_task`.
5. Настройте webhook'и (с теми же секретами, что в env):
   - Vercel → Webhooks на `https://<домен>/api/webhooks/vercel`, события
     `deployment.created`, `deployment.succeeded`, `deployment.error` (обрабатывается и
     `deployment.canceled`).
   - GitHub repo → Settings → Webhooks на `https://<домен>/api/webhooks/github`,
     content type `application/json`, событие **Deployment statuses**.
6. Подключите репозиторий к зеркалу GitHub → GitLab и создайте GitLab Pipeline Schedule
   `*/5 * * * *` с переменной `WATCHDOG_RUN=1`. Masked project variable `WATCHDOG_TOKEN`
   должна совпадать с digest в `lib/watchdog-auth.ts`; обычный CI и schedule описаны в
   [`.gitlab-ci.yml`](../.gitlab-ci.yml).
7. В `@BotFather`: `/newapp` → URL = `https://<ваш-домен>` — Mini App в Telegram.

## Обновление

- Push/merge в `main` → Vercel автоматически собирает и выкатывает production.
- После деплоя `/api/version` отдаёт новый `VERCEL_GIT_COMMIT_SHA`; `<AutoRefresh/>` на UI
  замечает смену SHA и перезагружает страницу — пользователи увидят обновление без действий.
- Схема БД меняется вручную: `pnpm db:push` с production `DATABASE_URL`.

## Откат

- **Reset к baseline**: `POST /api/admin/reset` перезаписывает whitelist-файлы версиями из
  git-тега `demo-baseline` одним коммитом (и по умолчанию чистит задачи) — Vercel пересобирает
  production за ~60 секунд. Пошагово — docs/SPEC.md §9.
- **Ревертом задачей**: «откати последнее изменение» — агент восстановит файлы из родительского
  коммита (авто-revert при prod-failure пока в roadmap, docs/ROADMAP.md).
- **Vercel Rollbacks** (Project → Deployments) — откат билда без git-операций.

## Наблюдаемость

| Сигнал | Источник |
|---|---|
| Упавший production build задачи | Подписанный GitHub webhook `deployment_status` (production failure) → задача `failed` с ссылкой на лог |
| Упавший/отменённый деплой ветки | Vercel webhook `deployment.error/canceled` → задача `failed` |
| Зависшие задачи | GitLab schedule каждые 5 минут вызывает watchdog: активный статус >5 мин без обновления → `failed`, слот мьютекса освобождён |
| Здоровье приложения | `GET /api/health` → `{"ok":true}`; `GET /api/version` → текущий commit SHA |
| Таймлайн шагов задачи | Таблица `task_events` (stage/kind/message/metadata) — виден на карточке задачи |
| Логи функций | Vercel Dashboard → Deployments → Functions (console.error пайплайна) |

## Куда дальше

- [docs/CONFIGURATION.md](CONFIGURATION.md) — переменные окружения для Vercel.
- [docs/SPEC.md](SPEC.md) — ограничения Vercel и принятые обходные решения (§7, §9).
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — как webhook'и и watchdog вписаны в пайплайн.
- [docs/GETTING-STARTED.md](GETTING-STARTED.md) — локальный запуск перед деплоем.
