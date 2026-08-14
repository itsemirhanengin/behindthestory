import type { ConnectionOptions } from "bullmq";

/**
 * Connection settings, not a connected client.
 *
 * Handing BullMQ a ready-made `ioredis` instance is the obvious move and the
 * wrong one here: BullMQ pins ioredis 5, while the rest of this workspace is on
 * ioredis 6. Passing an instance across that boundary means two copies of the
 * library sharing one socket — the type error is the visible half, and the
 * protocol-level surprises are the half that would show up in production.
 *
 * Given options instead, BullMQ constructs clients with its own ioredis and
 * manages their lifecycle, including the separate blocking connections a worker
 * needs.
 */
export function queueConnection(): ConnectionOptions {
  const raw = process.env.REDIS_URL;
  if (!raw) throw new Error("REDIS_URL is not set");

  const url = new URL(raw);

  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    // Upstash terminates TLS and routes on SNI, so the server name has to be
    // sent explicitly rather than left to the socket.
    tls: url.protocol === "rediss:" ? { servername: url.hostname } : undefined,
    /**
     * BullMQ requires this to be null. Its workers issue blocking reads that
     * legitimately sit open for minutes, and a retry limit turns those into
     * spurious failures. This is why the API's own client in
     * `apps/api/src/lib/redis.ts` cannot be reused: it sets a limit of 3 so a
     * struggling Redis surfaces as a failed sign-in instead of a hung request.
     */
    maxRetriesPerRequest: null,
  };
}
