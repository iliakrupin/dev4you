@AGENTS.md

## Project: dev4you (ФичуЗадачу)

Multi-agent dev automation. Аналитик ставит задачу в Telegram Mini App → один LLM-агент проходит этапы analysis → implement → test → deploy. Test/deploy реализованы через Vercel preview deployments.

## Стек
- Next.js 16 App Router (TS, Tailwind v4)
- Drizzle ORM + Vercel Postgres / Neon
- OpenAI SDK → внутренний Qwen 3.5 27B (OpenAI-compatible API)
- Octokit REST для git
- Telegram WebApp initData (HMAC validation)
- Vercel Hobby (10s serverless timeout — критично!)

## Конвенции
- Все UI-тексты на русском
- Mobile-first (Telegram Mini App, ширина ~390px)
- Каждый LLM-вызов — отдельный HTTP request (укладываемся в 10s)
- State машина живёт в БД, а не в памяти процесса
- `lib/env.ts` — единственная точка чтения `process.env`
- Никаких локальных git-команд — только Octokit REST

## Sandbox для агента (whitelist)
Агент может писать ТОЛЬКО в:
- `app/globals.css`
- `tailwind.config.ts` (если будет создан)
- `app/(public)/**`
- `components/ui/**`
- `public/**`

Агент НЕ может трогать:
- `.env*`, `lib/agent/**`, `lib/auth/**`, `lib/db/**`, `middleware.ts`,
  `package.json`, `.github/**`, файлы агентского пайплайна
