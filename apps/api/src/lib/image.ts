import { createHash } from "node:crypto";

/**
 * What an uploaded avatar is allowed to be.
 *
 * The client already resizes and re-encodes in a canvas before sending, so the
 * bytes arriving here are normally a small webp. None of that is trusted: a
 * request is a request, and the only thing worth believing about it is what the
 * first few bytes say.
 */

export const AVATAR_MAX_BYTES = 512 * 1024;

/** The one dimension the bucket serves. Enforced client-side; recorded here so
 *  both sides name the same number. */
export const AVATAR_PIXELS = 512;

type ImageKind = { mime: string; extension: string };

/**
 * Magic-byte sniffing, because `Content-Type` is caller-supplied and an SVG
 * announced as `image/png` is a stored-XSS vector the moment the bucket serves
 * it from an origin a browser trusts. Raster only, for the same reason: no
 * format here can carry script.
 */
function sniff(bytes: Uint8Array): ImageKind | null {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  // \x89 P N G \r \n \x1a \n
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { mime: "image/png", extension: "png" };
  }

  // JPEG SOI, and every JPEG variant continues with a marker.
  if (startsWith(0xff, 0xd8, 0xff)) {
    return { mime: "image/jpeg", extension: "jpg" };
  }

  // RIFF....WEBP — the size field sits between the two tags.
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", extension: "webp" };
  }

  return null;
}

export type AvatarProblem = "empty" | "too_large" | "unsupported";

export const AVATAR_PROBLEM_MESSAGE: Record<AvatarProblem, string> = {
  empty: "That file is empty.",
  too_large: `Keep it under ${Math.round(AVATAR_MAX_BYTES / 1024)} KB.`,
  unsupported: "Use a PNG, JPEG or WebP image.",
};

export type AvatarUpload = {
  body: Uint8Array;
  contentType: string;
  extension: string;
  /** Content hash, which becomes the object key — see `putAvatar`. */
  digest: string;
};

export function inspectAvatar(
  bytes: Uint8Array,
): { ok: true; upload: AvatarUpload } | { ok: false; problem: AvatarProblem } {
  if (bytes.byteLength === 0) return { ok: false, problem: "empty" };
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return { ok: false, problem: "too_large" };
  }

  const kind = sniff(bytes);
  if (!kind) return { ok: false, problem: "unsupported" };

  return {
    ok: true,
    upload: {
      body: bytes,
      contentType: kind.mime,
      extension: kind.extension,
      digest: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}
