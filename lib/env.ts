import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// URL вида http://, https://, postgresql:// и т.п. — без протокол-специфичной валидации.
const urlLike = z.string().min(1).refine(
  (s) => /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s),
  { message: "Должен быть URL с протоколом (http://, https://, postgresql://)" },
);

export const env = createEnv({
  server: {
    DATABASE_URL: urlLike,
    TELEGRAM_BOT_TOKEN: z.string().min(10),
    TELEGRAM_BOT_USERNAME: z.string().min(3),
    GITHUB_TOKEN: z.string().min(10),
    GITHUB_OWNER: z.string().min(1),
    GITHUB_REPO: z.string().min(1),
    GITHUB_BASE_BRANCH: z.string().default("main"),
    QWEN_BASE_URL: urlLike,
    QWEN_MODEL: z.string().min(1),
    QWEN_API_KEY: z.string().default("dummy"),
    // Опционально — если задан OPENROUTER_API_KEY, агент идёт через OpenRouter
    // вместо локального Qwen. Для демо/качества; для корп-контура — не задавать.
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().optional(),
    OPENROUTER_MODEL: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: urlLike,
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_OWNER: process.env.GITHUB_OWNER,
    GITHUB_REPO: process.env.GITHUB_REPO,
    GITHUB_BASE_BRANCH: process.env.GITHUB_BASE_BRANCH,
    QWEN_BASE_URL: process.env.QWEN_BASE_URL,
    QWEN_MODEL: process.env.QWEN_MODEL,
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
  // Vercel Preview environments часто не имеют всех env vars (особенно
  // секретов с галочкой только Production). Чтобы PR-сборка не падала
  // на T3 Env validation, скипуем её для preview/develop. Реальные
  // ошибки всё равно вылезут в runtime.
  skipValidation:
    process.env.SKIP_ENV_VALIDATION === "true" ||
    process.env.VERCEL_ENV === "preview" ||
    process.env.VERCEL_ENV === "development",
  // Лучшее сообщение об ошибке в Vercel build logs
  onValidationError: (issues) => {
    console.error("\n❌ Invalid environment variables:");
    for (const issue of issues) {
      console.error(`  - ${issue.path?.join(".")}: ${issue.message}`);
    }
    throw new Error("Invalid environment variables — см. логи выше");
  },
});
