import { createHash, timingSafeEqual } from "node:crypto";

// SHA-256 verifier для masked credential, который хранится только в GitLab.
// Исходное значение в репозиторий и Vercel не попадает.
const EXPECTED_DIGEST =
  "9d3ea4ce162a3b4c3639a9ba548bd99a141029d4fee57781bb4bfc93c7443abc";

export function isWatchdogAuthorized(
  authorization: string | null,
  expectedDigestHex = EXPECTED_DIGEST,
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
