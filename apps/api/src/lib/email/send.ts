import { Resend } from "resend";

import { SignInCodeEmail } from "#lib/email/templates/sign-in-code";
import { OTP_TTL_SECONDS } from "#lib/auth/otp";

let _resend: Resend | null = null;

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

function sender() {
  return process.env.EMAIL_FROM ?? "BehindTheStory <auth@behindthestory.co>";
}

export async function sendSignInCode(to: string, code: string) {
  const expiresInMinutes = Math.round(OTP_TTL_SECONDS / 60);

  const { error } = await getResend().emails.send({
    from: sender(),
    to,
    // The code leads the subject so it is readable from a lock-screen
    // notification without opening the mail app at all — on a phone that is
    // the difference between typing six digits and app-switching twice.
    subject: `${code} — your BehindTheStory sign-in code`,
    react: SignInCodeEmail({ code, expiresInMinutes }),
    // Transactional mail should never be threaded with a previous code.
    headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
  });

  if (error) {
    // Never let the provider's message reach the caller: it echoes the address
    // and would turn a failed send into an account-existence oracle.
    console.error("[email] sign-in code failed", error);
    throw new Error("Failed to send sign-in code");
  }
}
