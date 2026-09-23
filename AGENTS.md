<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Repository instructions

## Source of truth

- Read `README.md` and `docs/ARCHITECTURE.md`, then the relevant
  `docs/CONFIGURATION.md`, `docs/DEVELOPMENT.md`, and `docs/DEPLOYMENT.md`.
- Treat `package.json`, `pnpm-lock.yaml`, `app/`, `lib/`, `drizzle.config.ts`, and
  `lib/db/schema.ts` as the executable source of truth. The Drizzle schema, not
  prose or generated SQL, defines the current database model.
- Because this repository uses a newer Next.js release, keep the Next.js rule
  above: consult `node_modules/next/dist/docs/` before relying on remembered APIs.

## Current architecture and deployment

- This is a Next.js application deployed by Vercel from `main`.
- PostgreSQL stores tasks and the one-active-task mutex. GitHub hosts source,
  branches, PRs, and deployment webhooks. A GitLab schedule on the SER8 fleet
  calls the watchdog endpoint; GitLab is not the application workload host.
- A merge to `main` triggers the Vercel production build. Database schema changes
  are a separate, explicit `pnpm db:push` operation against the selected database.
  Do not present a successful merge or GitLab job as proof that either occurred.

## Development and verification

- Use pnpm and the checked-in lockfile: `pnpm install --frozen-lockfile`.
- Before committing, run `pnpm lint`, `pnpm exec tsc --noEmit`, and
  `SKIP_ENV_VALIDATION=true pnpm build`.
- Do not use `SKIP_ENV_VALIDATION` as proof that a real environment is configured;
  it is only a structural build check.
- Never commit `.env.local`, API keys, webhook secrets, database URLs, or user
  task data.

## Operations and history

- `docs/ROADMAP.md` and `docs/SPEC.md` contain product intent and history; current
  runtime behavior is established by code and the active deployment/config docs.
- Do not delete production tasks, database rows, or Vercel deployments during
  repository cleanup.
- Before changing external configuration, verify the Vercel project/environment,
  GitHub webhook target, GitLab schedule, and database destination using read-only
  checks. Deployment or database mutation requires an explicit user request.
