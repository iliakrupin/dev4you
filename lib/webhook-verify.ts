/**
 * Проверка подписей входящих webhook'ов и константно-временное сравнение.
 * Web Crypto — работает и в edge, и в nodejs runtime.
 */

async function hmacHex(
  hash: "SHA-256" | "SHA-1",
  secret: string,
  body: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Сравнение hex-строк за постоянное время (защита от timing side-channel). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * GitHub: заголовок X-Hub-Signature-256 = "sha256=<hex>", HMAC-SHA256 от raw body.
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export async function verifyGithubSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = await hmacHex("SHA-256", secret, rawBody);
  return timingSafeEqualHex(header.slice("sha256=".length), expected);
}

/**
 * Vercel: заголовок x-vercel-signature = HMAC-SHA1 (hex) от raw body.
 * https://vercel.com/docs/observability/webhooks-overview/webhooks-api#securing-webhooks
 */
export async function verifyVercelSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const expected = await hmacHex("SHA-1", secret, rawBody);
  return timingSafeEqualHex(header, expected);
}
