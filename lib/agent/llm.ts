import OpenAI from "openai";

let _client: OpenAI | null = null;

/**
 * Vercel Edge runtime запрещает прямой fetch по IP-адресам.
 * nip.io — публичный wildcard DNS, который резолвит `1.2.3.4.nip.io` → `1.2.3.4`,
 * так что Edge видит доменное имя и пропускает.
 */
function edgeSafeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(
    /^(https?:\/\/)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?=[:/])/,
    "$1$2.nip.io",
  );
}

/**
 * Если OPENROUTER_API_KEY задан — используем OpenRouter (managed, быстро,
 * любая модель: qwen/qwen3.6-plus, anthropic/claude-sonnet-4.5 и др.).
 * Иначе — fallback на локальный Qwen из QWEN_BASE_URL.
 *
 * ВАЖНО: OpenRouter — внешний облачный сервис. Для корпоративного контура
 * с проприетарным кодом нужен локальный Qwen (просто не задавать
 * OPENROUTER_API_KEY).
 */
export function llm(): OpenAI {
  if (_client) return _client;
  const useOpenRouter = !!process.env.OPENROUTER_API_KEY;
  _client = new OpenAI({
    baseURL: useOpenRouter
      ? (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1")
      : edgeSafeUrl(process.env.QWEN_BASE_URL),
    apiKey: useOpenRouter
      ? process.env.OPENROUTER_API_KEY!
      : (process.env.QWEN_API_KEY ?? "dummy"),
    timeout: 22_000,
    maxRetries: 0,
    // OpenRouter рекомендует HTTP-Referer и X-Title для прозрачности
    ...(useOpenRouter
      ? {
          defaultHeaders: {
            "HTTP-Referer": "https://dev4you-pi.vercel.app",
            "X-Title": "ФичуЗадачу (#КручуФичу)",
          },
        }
      : {}),
  });
  return _client;
}

export function qwenModel(): string {
  // Если используем OpenRouter — модель из его env. Иначе — локальный Qwen.
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_MODEL ?? "qwen/qwen3.6-plus";
  }
  return process.env.QWEN_MODEL ?? "Qwen/Qwen3.5-27B-GPTQ-Int4";
}
