import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { getRedis } from "#lib/redis";

/**
 * Six digits, not four.
 *
 * NIST SP 800-63B requires an out-of-band authentication secret to carry at
 * least 20 bits of entropy. Six decimal digits is ~19.9 bits and is the
 * explicitly sanctioned floor; four digits is ~13.3 bits, which with any
 * usable attempt allowance is guessable.
 */
const CODE_DIGITS = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;

export type VerifyOutcome = "ok" | "invalid" | "expired" | "exhausted";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters");
  }
  return value;
}

/**
 * Keyed rather than plain SHA-256. A bare hash of a six-digit code is trivially
 * reversed — a million candidates — so a leak of the Redis contents would be a
 * leak of live codes. With an HMAC the stored value is useless without the
 * server secret.
 */
function fingerprint(...parts: string[]) {
  return createHmac("sha256", secret()).update(parts.join(":")).digest("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Addresses never reach Redis in the clear; keys are derived, not stored. */
export function emailKey(email: string) {
  return fingerprint("email-key", normalizeEmail(email));
}

function otpRedisKey(email: string) {
  return `otp:${emailKey(email)}`;
}

/**
 * Where an email-change code lives.
 *
 * The account id is part of the key, not a field beside it. That is what makes
 * the code unusable by anyone else: a code issued so that user A can move to
 * `new@example.com` hashes to a key nobody else can name, so a second session
 * that happens to be requesting the same address cannot consume A's code, and
 * A cannot redirect their own verified code at a different address afterwards.
 *
 * Separate from the sign-in namespace for the same reason — a sign-in code
 * mailed to an address must not double as authorisation to move an account
 * onto it.
 */
function emailChangeRedisKey(userId: string, email: string) {
  return `email-change:${fingerprint("email-change-key", userId, normalizeEmail(email))}`;
}

export function generateCode() {
  // randomInt is rejection-sampled, so every code is equally likely — Math.random
  // and `% 1000000` are both biased.
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

/**
 * Issues a code at one key, replacing anything already outstanding there so
 * only the newest email in someone's inbox ever works.
 */
async function storeAt(key: string, digest: string) {
  await getRedis()
    .multi()
    .del(key)
    .hset(key, { fingerprint: digest, attempts: "0" })
    .expire(key, OTP_TTL_SECONDS)
    .exec();
}

export async function storeCode(email: string, code: string) {
  await storeAt(otpRedisKey(email), fingerprint("otp", normalizeEmail(email), code));
}

/** Issues the code that proves the writer can read the address they are moving to. */
export async function storeEmailChangeCode(
  userId: string,
  email: string,
  code: string,
) {
  await storeAt(
    emailChangeRedisKey(userId, email),
    fingerprint("email-change", userId, normalizeEmail(email), code),
  );
}

/**
 * Compare-and-consume in a single Redis round trip.
 *
 * This has to be one atomic step: two requests arriving with the correct code
 * must not both mint a session, and a wrong guess must increment the attempt
 * counter even if it races another guess. A read-then-delete from the app would
 * lose both properties.
 */
const CONSUME_SCRIPT = `
local stored = redis.call('HGET', KEYS[1], 'fingerprint')
if not stored then return 'expired' end

local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0')
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return 'exhausted'
end

if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 'ok'
end

if redis.call('HINCRBY', KEYS[1], 'attempts', 1) >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return 'exhausted'
end
return 'invalid'
`;

async function consumeAt(
  key: string,
  digest: string,
  code: string,
): Promise<VerifyOutcome> {
  // Cheap structural rejection so a malformed body never reaches Redis.
  if (!/^\d{6}$/.test(code)) return "invalid";

  return (await getRedis().eval(
    CONSUME_SCRIPT,
    1,
    key,
    digest,
    String(OTP_MAX_ATTEMPTS),
  )) as VerifyOutcome;
}

export async function consumeCode(
  email: string,
  code: string,
): Promise<VerifyOutcome> {
  return consumeAt(
    otpRedisKey(email),
    fingerprint("otp", normalizeEmail(email), code),
    code,
  );
}

export async function consumeEmailChangeCode(
  userId: string,
  email: string,
  code: string,
): Promise<VerifyOutcome> {
  return consumeAt(
    emailChangeRedisKey(userId, email),
    fingerprint("email-change", userId, normalizeEmail(email), code),
    code,
  );
}

/**
 * Constant-time equality for callers that already hold both digests. Redis does
 * the hot-path comparison inside the Lua script above, where atomicity matters
 * more; this exists for comparisons made in-process.
 */
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

