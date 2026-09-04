/**
 * Turning whatever the writer picked into the one thing the bucket stores.
 *
 * The work happens here rather than on the server for two reasons. A phone
 * photo is four megabytes and 4000 pixels wide, and uploading that to have it
 * thrown away is the slowest part of the whole interaction — so the resize has
 * to happen before the request, not after. And doing it in a canvas means the
 * server never needs an image-processing library: it re-encodes nothing, it
 * only sniffs the first few bytes and stores what arrived.
 *
 * The API still validates independently. This is a convenience, not a control.
 */

/** One square size, matching `AVATAR_PIXELS` on the API. */
const SIZE = 512;

/** Generous enough for a 512px photograph, small enough to reject a payload. */
export const AVATAR_UPLOAD_MAX_BYTES = 512 * 1024;

/** What the file picker will offer. Raster only — the API refuses anything
 *  that could carry script, so offering SVG would be offering a failure. */
export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

export class AvatarImageError extends Error {}

/**
 * Centre-crops to a square and re-encodes at `SIZE`.
 *
 * Centre-cropping rather than letterboxing: an avatar is rendered in a square
 * everywhere it appears, and bars around a portrait look like a mistake in a
 * way that a tighter crop does not. A cropper UI would be better still, and is
 * the obvious next iteration — this is the version that needs no dialog.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarImageError("Pick an image file.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // A file that names itself an image but cannot be decoded. Nothing here
    // can say more than that, and guessing would be worse.
    throw new AvatarImageError("That image could not be read.");
  }

  try {
    const edge = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const context = canvas.getContext("2d");
    if (!context) throw new AvatarImageError("That image could not be read.");

    // Bilinear-ish downscaling; the default in every engine is nearest for
    // large ratios, which turns a photograph into aliased noise.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      (bitmap.width - edge) / 2,
      (bitmap.height - edge) / 2,
      edge,
      edge,
      0,
      0,
      SIZE,
      SIZE,
    );

    const blob = await encode(canvas);
    if (blob.size > AVATAR_UPLOAD_MAX_BYTES) {
      throw new AvatarImageError(
        "That image is still too large after resizing. Try a simpler one.",
      );
    }
    return blob;
  } finally {
    // Bitmaps hold decoded pixels off-heap; without this a few picks in a row
    // keep tens of megabytes alive until GC notices.
    bitmap.close();
  }
}

/**
 * WebP, falling back to PNG.
 *
 * `toBlob` with an unsupported type silently produces a PNG rather than
 * failing, so the returned blob's own type is what gets checked — asking the
 * canvas for webp is not the same as having received it.
 */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", 0.9);
  if (webp && webp.type === "image/webp") return webp;

  const png = await toBlob(canvas, "image/png");
  if (png) return png;

  throw new AvatarImageError("That image could not be prepared.");
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
