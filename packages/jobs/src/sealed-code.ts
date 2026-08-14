import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Sign-in codes are encrypted before they are put on the queue.
 *
 * Redis already stores sign-in codes as an HMAC keyed with `AUTH_SECRET`, so
 * that reading the database does not yield usable codes. Queueing the delivery
 * email would undo that: a BullMQ payload is an ordinary Redis value, and the
 * worker needs the code in the clear to put it in the mail.
 *
 * Encrypting with a key derived from `AUTH_SECRET` — which lives in the
 * environment, not in Redis — keeps the original property. Redis holds
 * ciphertext; only a process that already has the secret can read it.
 *
 * AES-256-GCM rather than a bare cipher because the payload crosses a process
 * boundary: the authentication tag is what makes a tampered job fail loudly
 * instead of mailing an attacker-chosen code.
 */

const IV_BYTES = 12;

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  // AES-256 needs exactly 32 bytes; AUTH_SECRET is a printable string of
  // arbitrary length.
  return createHash("sha256").update(`sign-in-code:${secret}`).digest();
}

export function sealCode(code: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function openCode(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 3) throw new Error("sealed code is malformed");

  const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
