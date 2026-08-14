import { getRedis } from "@/lib/redis";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Zero when the request was allowed. */
  retryAfter: number;
};

/**
 * Fixed-window counter. A sliding window would be more precise, but the windows
 * here are minutes long and the thing being throttled is a human asking for an
 * email — precision at the boundary buys nothing.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const redisKey = `ratelimit:${key}`;

  // INCR then EXPIRE in one round trip. EXPIRE is set on every call rather than
  // only the first, so a burst cannot leave a counter without a TTL if the
  // process dies between the two commands.
  const [count, ttl] = (await redis
    .multi()
    .incr(redisKey)
    .expire(redisKey, windowSeconds, "NX")
    .ttl(redisKey)
    .exec()
    .then((replies) => [
      Number(replies?.[0]?.[1] ?? 0),
      Number(replies?.[2]?.[1] ?? windowSeconds),
    ])) as [number, number];

  if (count > limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, ttl) };
  }
  return { allowed: true, remaining: limit - count, retryAfter: 0 };
}

/** Ceilings chosen so a real person never meets them and a script always does. */
export const OTP_LIMITS = {
  perEmail: { limit: 3, windowSeconds: 15 * 60 },
  perIp: { limit: 10, windowSeconds: 15 * 60 },
} as const;
