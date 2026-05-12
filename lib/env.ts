import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    TELEGRAM_BOT_TOKEN: z.string().min(10),
    TELEGRAM_BOT_USERNAME: z.string().min(3),
    GITHUB_TOKEN: z.string().min(10),
    GITHUB_OWNER: z.string().min(1),
    GITHUB_REPO: z.string().min(1),
    GITHUB_BASE_BRANCH: z.string().default("main"),
    QWEN_BASE_URL: z.string().url(),
    QWEN_MODEL: z.string().min(1),
    QWEN_API_KEY: z.string().default("dummy"),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
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
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
