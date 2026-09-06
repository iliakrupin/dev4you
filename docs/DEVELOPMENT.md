# Разработка — КручуФичу (`dev4you`)

## Локальная настройка

Один раз: `pnpm install` → `cp .env.example .env.local` → заполнить → `pnpm db:push`.
Подробно — [docs/GETTING-STARTED.md](GETTING-STARTED.md); переменные —
[docs/CONFIGURATION.md](CONFIGURATION.md).

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` | Dev-сервер Next.js (http://localhost:3000) |
| `pnpm build` | Production-сборка Next.js |
| `pnpm start` | Запуск собранного приложения |
| `pnpm lint` | ESLint |
| `pnpm db:push` | Применить схему Drizzle прямо в БД (`drizzle-kit push --force`) — создаёт таблицы и индекс `one_active_task` |
| `pnpm db:generate` | Сгенерировать SQL-миграции из схемы в `drizzle/` |
| `pnpm db:studio` | Drizzle Studio — GUI для просмотра БД |

Тестового раннера в проекте нет (нет тест-скрипта, тестовых зависимостей и тестовых файлов).
В планах — visual regression через Playwright (см. docs/ROADMAP.md).

## Стиль кода

- **TypeScript strict** (`tsconfig.json`), moduleResolution bundler, алиас `@/*` → корень репо.
- **ESLint 9** (flat config, `eslint.config.mjs`): `eslint-config-next/core-web-vitals` +
  `eslint-config-next/typescript`; игнорируются `.next/`, `out/`, `build/`, `next-env.d.ts`.
  Запуск: `pnpm lint`. Prettier/Biome не настроены.
- Конвенции (из [AGENTS.md](../AGENTS.md)): все UI-тексты на русском; mobile-first под
  Telegram Mini App (~390px); один LLM-вызов — один HTTP-запрос (бюджет 25 c Edge); state machine
  живёт в БД; `process.env` читать только через `lib/env.ts`; никаких локальных git-команд —
  только Octokit.
- **Next.js 16** — ломающие изменения относительно привычных версий; актуальные гайды лежат в
  `node_modules/next/dist/docs/` (см. блок в AGENTS.md).

## Специфика: Drizzle

- Схема — единственный источник истины: [`lib/db/schema.ts`](../lib/db/schema.ts)
  (`tasks`, `task_events`, enum `task_status`, индекс `one_active_task`).
- Основной рабочий процесс — `pnpm db:push`: применяет схему напрямую к БД из `DATABASE_URL`.
  Частичный уникальный индекс `one_active_task` выражен через `sql`-шаблон и применяется только
  `db:push` — после создания новой БД выполнить обязательно.
- `pnpm db:generate` кладёт SQL-миграции в `drizzle/` (out-dir из `drizzle.config.ts`,
  `strict: true`).

## Ветки и коммиты

- Разработка — в `main` (репозиторий один, демо живёт в нём же).
- Агент для каждой задачи создаёт ветку `task/N`, коммитит одним GraphQL-коммитом с сообщением
  `task #N: <цель>` и после merge удаляет ветку. История `main` — череда `task #N: …` и
  `Revert "task #M…"`: это лог работы демо.
- Хост-разработчик коммитит обычным порядком; изменения схемы БД требуют `pnpm db:push`.

## Pull request

- PR от агента: заголовок `task #N: <цель>`, тело — задача, план, список файлов; мержится
  squash-методом автоматически (`finalizeImplement`), без human review (workaround сломанного
  preview — docs/SPEC.md §7).
- Ручные PR (если появятся) тоже проходят через CI: typecheck + build.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — job `typecheck` на push и PR в `main`
(Node 24, pnpm 10):

1. `pnpm install --frozen-lockfile`
2. `pnpm exec tsc --noEmit` — типы, импорты, Module not found.
3. `SKIP_ENV_VALIDATION=true pnpm build` — сборка Next.js без реальных env.

Именно эти две проверки стоит гнать локально перед PR.

## Куда дальше

- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — устройство пайплайна и подсистем.
- [docs/CONFIGURATION.md](CONFIGURATION.md) — переменные окружения для локальной разработки.
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — как изменения попадают в production.
- [docs/ROADMAP.md](ROADMAP.md) — что планируется дальше (включая тесты).
