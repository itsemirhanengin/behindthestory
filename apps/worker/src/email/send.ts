import { Resend } from "resend";

import { SignInCodeEmail } from "#email/templates/sign-in-code";

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

/**
 * The expiry is passed in rather than read from the OTP module: that module
 * lives in the API, which is what mints the code. Handing the number over with
 * the job keeps the worker from reaching back into another app's auth
 * internals just to render a sentence.
 */
export async function sendSignInCode(to: string, code: string, expiresInMinutes: number) {
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
