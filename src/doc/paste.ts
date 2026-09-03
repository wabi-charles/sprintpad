import { isTaskLine, normalizeImportedText } from "./grammar";

export interface PasteContext {
  /** Whether the paste lands at the very start of a line. */
  atLineStart: boolean;
}

/**
 * Spec §16: dropping a block of plain lines in should produce tasks, not
 * headers. This is an intent-driven transform rather than a grammar rule --
 * typing a bare line still gives you a header, only pasting converts.
 *
 * Returns the replacement text, or null to paste verbatim.
 */
export function transformPastedText(raw: string, context: PasteContext): string | null {
  const text = normalizeImportedText(raw);
  const lines = text.split("\n");

  // A single item is usually a fragment (a URL, a snippet), not a list.
  if (lines.filter((line) => line.trim() !== "").length < 2) return null;

  // Anything already carrying markers is sprintpad content -- paste it exactly,
  // so cut/copy/paste within the document is lossless.
  if (lines.some(isTaskLine)) return text === raw ? null : text;

  const converted = lines.map((line, index) => {
    if (line.trim() === "") return line;
    // Mid-line, the first pasted line continues the task already under the cursor.
    if (index === 0 && !context.atLineStart) return line;
    const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
    return `${indent}[] ${line.slice(indent.length)}`;
  });

  return converted.join("\n");
}
