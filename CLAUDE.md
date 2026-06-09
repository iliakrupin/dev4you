@AGENTS.md

## Project: dev4you (ФичуЗадачу)

Multi-agent dev automation. Аналитик ставит задачу в Telegram Mini App → один LLM-агент проходит этапы analysis → implement → test → deploy. Test/deploy реализованы через Vercel preview deployments.

## Стек
- Next.js 16 App Router (TS, Tailwind v4)
- Drizzle ORM + Vercel Postgres / Neon
- OpenAI SDK → внутренний Qwen 3.5 27B (OpenAI-compatible API)
- Octokit REST для git
- Telegram WebApp initData (HMAC validation)
- Vercel Pro. Пайплайн-роуты — Edge runtime, `maxDuration = 25` (НЕ 10s как на
  nodejs/Hobby — это и даёт бюджет на LLM-вызов + Octokit). Webhooks/reset/cron —
  nodejs. Источник истины по таймауту — `export const maxDuration` в каждом route.

## Конвенции
- Все UI-тексты на русском
- Mobile-first (Telegram Mini App, ширина ~390px)
- Каждый LLM-вызов — отдельный HTTP request (укладываемся в ~25s Edge-бюджета)
- State машина живёт в БД, а не в памяти процесса
- `lib/env.ts` — единственная точка чтения `process.env`
- Никаких локальных git-команд — только Octokit REST

## Sandbox для агента (whitelist)
⚠️ Источник истины — `lib/agent/sandbox.ts` (`ALLOWED_PATTERNS` /
`PROTECTED_FROM_DELETION`). Этот список — лишь резюме, при расхождении верь коду.

Агент может писать ТОЛЬКО в (резюме `ALLOWED_PATTERNS`):
- `app/globals.css`, `tailwind.config.{ts,js,mjs,cjs}`
- `app/page.tsx`, `app/new/**`, `app/tasks/[id]/**`, `app/(public)/**`
- `components/**` (КРОМЕ `*auto-refresh*`)
- `public/**` (картинки/иконки/статика)

Структурно важные файлы можно только редактировать, НЕ удалять
(`PROTECTED_FROM_DELETION`: `app/page.tsx`, `app/layout.tsx`, `app/new/**`,
`app/tasks/**`, `components/task-card.tsx`, `status-badge.tsx`, `timeline.tsx` и др.).

Агент НЕ может трогать:
- `.env*`, `lib/**`, `middleware.ts`, `package.json`, `.github/**`,
  `components/*auto-refresh*`, файлы агентского пайплайна
