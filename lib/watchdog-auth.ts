import { createHash, timingSafeEqual } from "node:crypto";

// SHA-256 от случайного 256-битного WATCHDOG_TOKEN, который хранится только как
// masked project variable в GitLab. Сам токен в репозиторий и Vercel не попадает.
const WATCHDOG_TOKEN_SHA256 =
  "9d3ea4ce162a3b4c3639a9ba548bd99a141029d4fee57781bb4bfc93c7443abc";

export function isWatchdogAuthorized(
  authorization: string | null,
  expectedDigestHex = WATCHDOG_TOKEN_SHA256,
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;

  const token = authorization.slice("Bearer ".length);
  if (!token) return false;

  const actualDigest = createHash("sha256").update(token, "utf8").digest();
  const expectedDigest = Buffer.from(expectedDigestHex, "hex");

  return (
    expectedDigest.length === actualDigest.length &&
    timingSafeEqual(actualDigest, expectedDigest)
  );
}
