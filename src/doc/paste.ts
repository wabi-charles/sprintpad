import { normalizeImportedText } from "./grammar";

/**
 * Spec §16 mostly solves itself now that a bare line is a task: pasted plain
 * lines need no conversion at all. All that is left is widening markdown and
 * unicode checkboxes, and getting out of the way otherwise -- returning null
 * pastes verbatim, which keeps in-app copy/paste lossless.
 */
export function transformPastedText(raw: string): string | null {
  const text = normalizeImportedText(raw);
  return text === raw ? null : text;
}
