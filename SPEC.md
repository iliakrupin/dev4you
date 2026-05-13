# SPEC — ФичуЗадачу (`dev4you`)

Полная спецификация продукта: видение, аудитория, архитектура, ограничения и сценарии. Собрана из итогов интервью с автором.

## 1. Видение

**«Аналитик без разработчиков».** Бизнес-аналитик ставит задачу текстом — multi-agent система автономно её формализует, пишет код, тестирует и выкатывает на стенд. Человек подключается только в двух точках: постановка и финальная приёмка.

Долгосрочная цель — заменить рутинную часть работы команды разработки в корпоративном контуре, где код не должен покидать периметр.

## 2. Целевая аудитория

**Первая итерация (демо):** русскоязычное AI-сообщество в Telegram. Технически грамотные люди, которым важны не только результат, но и прозрачность работы агентов: видимый pipeline, реальные diff'ы, открытый репозиторий.

**Долгосрочно:** аналитики и менеджеры в средних/крупных российских компаниях, где требования службы информационной безопасности запрещают передачу кода во внешние LLM.

## 3. Эталонные сценарии демо

Над **самим дашбордом** (саморазвивающаяся система):

1. **«Сделай акцентный цвет красным»** — агент меняет CSS-переменные `--accent` / `--accent-soft`, открывает PR, Vercel собирает preview, авто-merge, главная сама перерисовывается. Это ключевой WOW-момент.
2. **«Откати последнее изменение темы»** — агент через `git revert` восстанавливает прежнее содержимое из родительского коммита.

Демо ставится **в Telegram-сообществе**, формат — Mini App (mobile-first WebView, обновляется автоматически при новом деплое).

## 4. Workflow

```
[Telegram Mini App: новая задача]
        ↓ POST /api/tasks (Edge, 25s)
[insert task → after()]
        ↓
[runAnalysis] 1 LLM-call → структурированный spec (zod-валидация)
        ↓ fire-and-forget
[POST /api/tasks/[id]/implement] (Edge, 25s, инкрементально)
        ↓
[runImplement] для каждого файла из spec.targetFiles:
        ↓ 1 LLM-call с stream:true
        ↓ результат сохраняется в tasks.producedFiles
        ↓ self-trigger следующего шага через fetch
[finalizeImplement] когда pendingFiles пуст:
        ↓ Octokit: createBranch + writeFile×N + openPullRequest
        ↓ status='ready_for_review'
[Vercel автоматически собирает preview deployment для PR]
        ↓
[GitHub шлёт webhook deployment_status=success]
        ↓ POST /api/webhooks/github
[Octokit merge PR в main]
        ↓ status='merged'
[Vercel деплоит main]
        ↓
[<AutoRefresh/> в UI ловит смену commit SHA → reload]
```

Никакого human-in-the-loop между постановкой и видимым результатом. При провале на любом этапе — `status='failed'`, сообщение в `errorMessage` с префиксом этапа (`analysis:` / `implement:` / `deploy:`).

## 5. Sandbox для агента

Агент имеет доступ только к whitelist путей (см. [`lib/agent/sandbox.ts`](lib/agent/sandbox.ts)):

- `app/globals.css` — CSS-переменные темы
- `tailwind.config.ts` — конфиг Tailwind
- `app/page.tsx`, `app/new/**`, `app/tasks/**` — публичные страницы UI
- `components/**` (кроме `auto-refresh` / `list-auto-refresh` — клиентская инфраструктура)
- `public/**` — статика

Запрещено: `.env*`, `lib/agent/**`, `lib/db/**`, `middleware.ts`, `package.json`, `.github/**`. Любая попытка записи вне whitelist валит задачу с `SandboxError`.

**Защита от prompt-injection** на уровне системного промпта: запросы вроде «удали базу», «отключи проверки», «забудь предыдущие инструкции» агент маркирует как невыполнимые и пишет причину в `goal`.

## 6. Технологический стек

| Слой | Решение |
|---|---|
| Frontend | Next.js 16 (App Router, React 19), Tailwind v4, mobile-first |
| Auth | Telegram WebApp `initData` (HMAC-SHA256 валидация) |
| API | Next.js Route Handlers, **Edge runtime** (25s timeout на Hobby) |
| База данных | Vercel Postgres / Neon + Drizzle ORM |
| Векторный поиск | pgvector (запланирован, в MVP не используется) |
| LLM (демо) | Внутренний **Qwen 3.5 27B GPTQ-Int4** через OpenAI-совместимый endpoint |
| LLM (доступ) | `<ip>.nip.io` обходит запрет Edge на прямой IP-fetch |
| Git | Octokit REST (ветки, файлы, PR, мерджи) — без локального git |
| Стенд | **Vercel Preview Deployments** для каждого PR |
| Авто-merge | GitHub `deployment_status` webhook → Octokit merge |
| Хостинг | Vercel **Hobby (бесплатный)** |
| Live UI | router.refresh каждые 3 сек на главной + polling задачи + auto-reload по смене commit SHA |

## 7. Ограничения и решения

### Vercel Hobby = 25s Edge timeout
- LLM-вызов на средних файлах занимает 15-22 сек.
- **Решение:** инкрементальный implement — один файл за HTTP-вызов. Между файлами self-trigger через fetch. Каждый шаг получает свои 25s.

### Edge запрещает fetch по IP
- LLM-сервер по адресу `212.41.6.240` без домена.
- **Решение:** прозрачная подмена в коде на `212.41.6.240.nip.io` (publicly hosted wildcard DNS).

### Ограниченное качество локального Qwen
- 27B Int4 хуже Claude/GPT-4 на сложных задачах.
- **Решения:** zod-схема толерантна к вариациям LLM-output (поля `string|array`); 2 попытки на каждом этапе; явные подсказки в системном промпте; стриминг ответа.

### Корпоративный ИБ-контур (долгосрочно)
- Код проприетарный — облачные LLM запрещены.
- **Подход:** локальные модели через OpenAI-совместимый API (vLLM / Ollama). Стек уже vendor-agnostic.

### Очередь задач
- Сейчас параллельные задачи могут конфликтовать на git merge.
- В roadmap — мьютекс на main.

## 8. Безопасность

- Telegram `initData` валидируется через HMAC от bot token (Web Crypto API, edge-friendly).
- Все секреты — через Vercel Environment Variables, в коде `process.env` единой точкой ([`lib/env.ts`](lib/env.ts)).
- `.env.local` в `.gitignore`.
- Public GitHub репо: код виден сообществу, токены не попадают (env-валидация при билде ловит опечатки).
- В MVP **нет аутентификации в смысле user accounts** — `telegram_id` достаточно для идентификации в Mini App. Для публичного веба `telegramUserId=0`, `username='anon'`.

## 9. Roadmap

См. [ROADMAP.md](ROADMAP.md) — упорядоченный список доработок.

## 10. История

Проект построен за один день (2026-05-12) в режиме pair-coding с Claude Code (Opus 4.7). Каждая задача в репо после первого зелёного pipeline ставилась через сам сервис, агент менял код собственного дашборда. Это и есть «саморазвивающаяся демо-система» из видения.
