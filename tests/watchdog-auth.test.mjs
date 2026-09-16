import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { isWatchdogAuthorized } from "../lib/watchdog-auth.ts";

const token = "test-token";
const digest = createHash("sha256").update(token).digest("hex");

test("accepts the configured bearer token", () => {
  assert.equal(isWatchdogAuthorized(`Bearer ${token}`, digest), true);
});

test("rejects missing, malformed, and incorrect credentials", () => {
  assert.equal(isWatchdogAuthorized(null, digest), false);
  assert.equal(isWatchdogAuthorized(token, digest), false);
  assert.equal(isWatchdogAuthorized("Bearer ", digest), false);
  assert.equal(isWatchdogAuthorized("Bearer wrong-token", digest), false);
});
