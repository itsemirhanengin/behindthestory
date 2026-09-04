import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { enqueueSignInEmail } from "@behindthestory/jobs/queues";

import {
  OTP_TTL_SECONDS,
  consumeCode,
  emailKey,
  generateCode,
  normalizeEmail,
  storeCode,
} from "#lib/auth/otp";
import { OTP_LIMITS, rateLimit } from "#lib/auth/rate-limit";
import { clientIp } from "#lib/auth/request";
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  listSessions,
  resolveSession,
  revokeSession,
  startSession,
} from "#lib/auth/session";
import { avatarUrlFor } from "#lib/storage";
import { requireAuth, sessionToken, type AuthEnv } from "#middleware/auth";

const FAILURES = {
  invalid: { status: 400, error: "That code is not right." },
  expired: { status: 400, error: "That code has expired. Request a new one." },
  exhausted: { status: 429, error: "Too many attempts. Request a new code." },
} as const;

/**
 * Chained rather than declared statement by statement — RPC types are inferred
 * from the chain, so breaking it up would hand the clients `any`.
 */
export const authRoutes = new Hono<AuthEnv>()
  /**
   * Issues a sign-in code. Always answers 200, whatever happened: any other
   * status — "no such account", "already registered" — turns this endpoint into
   * a way to test whether an address has an account here.
   */
  .post(
    "/otp/request",
    zValidator("json", z.object({ email: z.email().max(320) })),
    async (c) => {
      const email = normalizeEmail(c.req.valid("json").email);
      const ip = clientIp(c.req.raw);

      const [byEmail, byIp] = await Promise.all([
        rateLimit(
          `otp:email:${emailKey(email)}`,
          OTP_LIMITS.perEmail.limit,
          OTP_LIMITS.perEmail.windowSeconds,
        ),
        rateLimit(`otp:ip:${ip}`, OTP_LIMITS.perIp.limit, OTP_LIMITS.perIp.windowSeconds),
      ]);

      // 429 is safe to expose: it is keyed on the caller's own behaviour, not
      // on whether the address exists.
      if (!byEmail.allowed || !byIp.allowed) {
        const retryAfter = Math.max(byEmail.retryAfter, byIp.retryAfter);
        c.header("retry-after", String(retryAfter));
        return c.json({ error: "Too many requests", retryAfter }, 429);
      }

      const code = generateCode();
      await storeCode(email, code);

      try {
        // Queued rather than sent here: Resend is a third-party round trip on
        // the critical path of every sign-in, and a slow provider should not
        // decide how long this request takes. The worker also retries, which
        // an inline send could not do without holding the caller.
        await enqueueSignInEmail({
          email,
          code,
          expiresInMinutes: Math.round(OTP_TTL_SECONDS / 60),
        });
      } catch (error) {
        // Logged, not returned. Surfacing it would leak that we got as far as
        // trying to mail this address.
        console.error("[auth] could not queue sign-in code", error);
      }

      return c.json({ ok: true });
    },
  )
  .post(
    "/otp/verify",
    zValidator(
      "json",
      z.object({
        email: z.email().max(320),
        code: z.string().regex(/^\d{6}$/),
        client: z.enum(["web", "mobile"]).default("web"),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const email = normalizeEmail(body.email);

      // Consumed in Redis first. If the session write below fails the code is
      // burnt and the writer asks for another one — an annoyance. The reverse
      // order would leave a used code alive, which is a hole.
      const outcome = await consumeCode(email, body.code);
      if (outcome !== "ok") {
        const failure = FAILURES[outcome];
        return c.json({ error: failure.error }, failure.status);
      }

      const session = await startSession({
        email,
        client: body.client,
        userAgent: c.req.header("user-agent") ?? "",
        ip: clientIp(c.req.raw),
      });

      if (body.client === "web") {
        setCookie(c, SESSION_COOKIE, session.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "Lax",
          path: "/",
          maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
        });
      }

      return c.json({
        user: session.user,
        // Mobile keeps this in secure storage and sends it as a bearer token;
        // the web app ignores it and rides the cookie above.
        token: body.client === "mobile" ? session.token : undefined,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  )
  /** Who am I, and where else am I signed in. Public: a signed-out caller is a
   *  legitimate answer, not an error. */
  .get("/session", async (c) => {
    const user = await resolveSession(sessionToken(c));
    if (!user) return c.json({ user: null, devices: [] });

    return c.json({
      // The avatar is resolved here rather than in the client: the bucket's
      // public origin is deployment configuration, and a browser that had to
      // know it would need it injected at build time.
      user: { ...user, avatarUrl: avatarUrlFor(user.avatarKey) },
      devices: await listSessions(user.id),
    });
  })
  /** Sign out this device only. */
  .delete("/session", requireAuth, async (c) => {
    const token = sessionToken(c);
    if (token) await revokeSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
