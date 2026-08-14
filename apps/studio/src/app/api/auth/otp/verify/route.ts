import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeCode, normalizeEmail } from "@/lib/auth/otp";
import { clientIp } from "@/lib/auth/request";
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  startSession,
} from "@/lib/auth/session";

const Body = z.object({
  email: z.email().max(320),
  code: z.string().regex(/^\d{6}$/),
  client: z.enum(["web", "mobile"]).default("web"),
});

const FAILURES = {
  invalid: { status: 400, error: "That code is not right." },
  expired: { status: 400, error: "That code has expired. Request a new one." },
  exhausted: {
    status: 429,
    error: "Too many attempts. Request a new code.",
  },
} as const;

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);

  // Consumed in Redis first. If the session write below fails the code is burnt
  // and the writer asks for another one — an annoyance. The reverse order would
  // leave a used code alive, which is a hole.
  const outcome = await consumeCode(email, parsed.data.code);
  if (outcome !== "ok") {
    const failure = FAILURES[outcome];
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  const session = await startSession({
    email,
    client: parsed.data.client,
    userAgent: request.headers.get("user-agent") ?? "",
    ip: clientIp(request),
  });

  const response = NextResponse.json({
    user: session.user,
    // Mobile keeps this in secure storage and sends it as a bearer token; the
    // web app ignores it and rides the cookie below.
    token: parsed.data.client === "mobile" ? session.token : undefined,
    expiresAt: session.expiresAt.toISOString(),
  });

  if (parsed.data.client === "web") {
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });
  }

  return response;
}
