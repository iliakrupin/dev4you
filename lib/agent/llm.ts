import OpenAI from "openai";

let _client: OpenAI | null = null;

export function llm(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({
    baseURL: process.env.QWEN_BASE_URL,
    apiKey: process.env.QWEN_API_KEY ?? "dummy",
    timeout: 25_000,
    maxRetries: 0,
  });
  return _client;
}

export function qwenModel(): string {
  return process.env.QWEN_MODEL ?? "Qwen/Qwen3.5-27B-GPTQ-Int4";
}
