import OpenAI from "openai";

let _client: OpenAI | null = null;

/**
 * Vercel Edge runtime запрещает прямой fetch по IP-адресам.
 * `nip.io` — публичный wildcard DNS, который резолвит `1.2.3.4.nip.io` → `1.2.3.4`,
 * так что Edge видит доменное имя и пропускает.
 */
function edgeSafeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(
    /^(https?:\/\/)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?=[:/])/,
    "$1$2.nip.io",
  );
}

export function llm(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({
    baseURL: edgeSafeUrl(process.env.QWEN_BASE_URL),
    apiKey: process.env.QWEN_API_KEY ?? "dummy",
    timeout: 22_000,
    maxRetries: 0,
  });
  return _client;
}

export function qwenModel(): string {
  return process.env.QWEN_MODEL ?? "Qwen/Qwen3.5-27B-GPTQ-Int4";
}
