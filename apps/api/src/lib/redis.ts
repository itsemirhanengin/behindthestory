import Redis from "ioredis";

/**
 * Redis over the standard protocol, not Upstash's REST client.
 *
 * The REST client exists so stateless edge functions can talk to Redis without
 * holding a socket. We run in a long-lived container, where a persistent
 * connection is both cheaper and the only thing BullMQ can use later — it needs
 * blocking commands the REST surface does not expose.
 */
function createRedis() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");

  const client = new Redis(url, {
    // BullMQ requires this to be null, and it is the right setting here too:
    // a command that has already been retried a few times should surface as an
    // error rather than hang a sign-in request.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on("error", (error) => {
    console.error("[redis] connection error", error.message);
  });

  return client;
}

let _redis: Redis | null = null;

export function getRedis() {
  if (!_redis) _redis = createRedis();
  return _redis;
}
