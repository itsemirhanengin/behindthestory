import { NextResponse } from "next/server";
import { z } from "zod";

import { generateCode, normalizeEmail, storeCode, emailKey } from "@/lib/auth/otp";
import { OTP_LIMITS, rateLimit } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/auth/request";
import { sendSignInCode } from "@/lib/email/send";

const Body = z.object({ email: z.email().max(320) });

/**
 * Issues a sign-in code.
 *
 * Always answers 200, whatever happened. Any other status — "no such account",
 * "already registered", even a slower response — turns this endpoint into a
 * way to test whether an address has an account here.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const ip = clientIp(request);

  const [byEmail, byIp] = await Promise.all([
    rateLimit(`otp:email:${emailKey(email)}`, OTP_LIMITS.perEmail.limit, OTP_LIMITS.perEmail.windowSeconds),
    rateLimit(`otp:ip:${ip}`, OTP_LIMITS.perIp.limit, OTP_LIMITS.perIp.windowSeconds),
  ]);

  // 429 is safe to expose: it is keyed on the caller's own behaviour, not on
  // whether the address exists.
  if (!byEmail.allowed || !byIp.allowed) {
    const retryAfter = Math.max(byEmail.retryAfter, byIp.retryAfter);
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const code = generateCode();
  await storeCode(email, code);

  try {
    await sendSignInCode(email, code);
  } catch (error) {
    // Logged, not returned. A delivery failure is ours to see, and surfacing it
    // would leak that we got as far as trying to mail this address.
    console.error("[auth] could not deliver sign-in code", error);
  }

  return NextResponse.json({ ok: true });
}
