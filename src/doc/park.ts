/**
 * Putting a stray thought somewhere it will keep, without leaving the task.
 *
 * The rule is deliberately dull: a parked line goes at the very end of the
 * document. That is where the starter list keeps its backlog, it needs no
 * magic heading to look for, and it is easy to say out loud -- "it goes to the
 * bottom" -- which matters for something you use without looking.
 *
 * The edit is expressed as one span rather than a new document, and that span
 * is past everything else. Nothing before the cursor moves, so the cursor does
 * not move either, and a running session's anchor is untouched. That is the
 * whole point: writing the thought down must not cost you your place.
 */

export interface ParkEdit {
  from: number;
  to: number;
  insert: string;
}

/** Where the document's real content stops, ignoring trailing blank lines. */
function contentEnd(doc: string): number {
  let end = doc.length;
  const lines = doc.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.trim() !== "") break;
    // The newline that introduced this blank line goes with it.
    end -= line.length + (i > 0 ? 1 : 0);
  }
  return Math.max(0, end);
}

/**
 * The change that files `text` at the bottom, or null when there is nothing
 * worth filing.
 */
export function parkEdit(doc: string, text: string): ParkEdit | null {
  // One line: a thought typed in a hurry may arrive with a newline in it, and
  // a task is a line.
  const line = text.replace(/\s+/g, " ").trim();
  if (line === "") return null;

  const end = contentEnd(doc);
  return {
    from: end,
    to: doc.length,
    insert: end === 0 ? line : `\n${line}`,
  };
}

/** The same edit applied, for callers that hold the document as a string. */
export function park(doc: string, text: string): string {
  const edit = parkEdit(doc, text);
  if (!edit) return doc;
  return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
}
