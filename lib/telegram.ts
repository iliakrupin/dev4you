import { env } from "@/lib/env";
import { timingSafeEqualHex } from "@/lib/webhook-verify";

// initData старше этого возраста считаем протухшей (replay-защита).
const INIT_DATA_TTL_SEC = 86_400; // 24 часа

/**
 * Validates Telegram WebApp initData per HMAC-SHA256 spec.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function validateInitData(
  initData: string,
): Promise<TelegramUser | null> {
  const url = new URLSearchParams(initData);
  const hash = url.get("hash");
  if (!hash) return null;
  url.delete("hash");

  // Replay-защита: отклоняем initData без свежего auth_date. Без неё однажды
  // перехваченная валидная initData действует вечно.
  const authDate = Number(url.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (Date.now() / 1000 - authDate > INIT_DATA_TTL_SEC) return null;

  const dataCheckString = [...url.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    enc.encode(env.TELEGRAM_BOT_TOKEN),
  );

  const finalKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    finalKey,
    enc.encode(dataCheckString),
  );
  const computed = bufToHex(sig);

  if (!timingSafeEqualHex(computed, hash)) return null;

  const userJson = url.get("user");
  if (!userJson) return null;
  try {
    const user = JSON.parse(userJson) as TelegramUser;
    return user;
  } catch {
    return null;
  }
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

// Anonymous user for dev / when initData missing
export const ANON_USER: TelegramUser = {
  id: 0,
  username: "anon",
};
