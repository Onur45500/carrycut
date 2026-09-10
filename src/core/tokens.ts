import { getEncoding } from "js-tiktoken";
import { DEFAULT_CALIBRATION } from "./types.js";

const encoding = getEncoding("o200k_base");

/**
 * Count tokens with tiktoken o200k_base, then apply a calibration multiplier
 * approximating Claude's tokenizer (typically ~10–25% higher than o200k).
 * Result is rounded up so we never under-estimate near thresholds.
 */
export function countTokens(
  text: string,
  calibration: number = DEFAULT_CALIBRATION,
): number {
  if (!text) return 0;
  const raw = encoding.encode(text).length;
  return Math.ceil(raw * calibration);
}

/** Raw tiktoken count without calibration (for tests / debugging). */
export function countTokensRaw(text: string): number {
  if (!text) return 0;
  return encoding.encode(text).length;
}
