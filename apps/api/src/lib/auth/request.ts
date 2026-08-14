/**
 * The client's address, read from the proxy header Railway sets.
 *
 * Only used for rate-limit bucketing and the device list, never for
 * authorisation — it is caller-influenced and must not gate access.
 */
export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
