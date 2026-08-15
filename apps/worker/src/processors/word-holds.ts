import { sweepStaleHolds } from "@behindthestory/core/word-balance";

/**
 * Gives back reservations whose generation never reported an outcome.
 *
 * Every normal path releases its own hold — the stream's `onSettled` fires
 * even when the writer closes the tab. What this catches is the path with no
 * code on it: the container being replaced mid-generation, or the process
 * dying between the hold and the settle. Without it those words stay reserved
 * forever, and the writer watches their allowance shrink for no visible reason.
 *
 * Fifteen minutes is comfortably longer than the slowest chapter draft, so a
 * hold this old is not a slow generation.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

export async function processWordHoldsSweep() {
  const { scanned, released } = await sweepStaleHolds(STALE_AFTER_MS);
  if (released > 0) {
    console.log(`[worker] released ${released} stale hold(s) of ${scanned} scanned`);
  }
  return { scanned, released };
}
