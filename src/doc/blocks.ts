import { parseLine } from "./grammar";

/**
 * What a row carries when it moves.
 *
 * A task and everything indented under it are one thing. Moving a task that
 * has subtasks and leaving them behind would hand them to whichever task ends
 * up above them -- so a row moves as a block, the same way on a phone and at a
 * desk. Both shells use this, so the two cannot disagree about what a block is.
 */

/** Zero-based line indices, inclusive at both ends. */
export interface Block {
  start: number;
  end: number;
}

/**
 * The row at `index` and every line indented beneath it. A header owns only
 * itself: sections are not dragged around by their titles. Blank lines inside
 * a block travel with it; blank lines after it belong to what follows.
 */
export function blockOf(lines: readonly string[], index: number): Block | null {
  const head = lines[index];
  if (head === undefined) return null;
  const depth = parseLine(head).indent;

  let end = index;
  for (let i = index + 1; i < lines.length; i++) {
    const line = parseLine(lines[i]!);
    if (line.kind === "header") break;
    if (line.kind !== "blank" && line.indent <= depth) break;
    end = i;
  }
  while (end > index && parseLine(lines[end]!).kind === "blank") end--;
  return { start: index, end };
}

/**
 * The lines with `block` moved to sit before line `before` (0 to
 * lines.length). Indentation is kept exactly: where a block lands is where the
 * drop line was drawn, and nothing about it is reinterpreted. Null when it
 * would land where it already is.
 */
export function moveBlock(lines: readonly string[], block: Block, before: number): string[] | null {
  if (before >= block.start && before <= block.end + 1) return null;
  if (before < 0 || before > lines.length) return null;

  const out = [...lines];
  const moved = out.splice(block.start, block.end - block.start + 1);
  const at = before > block.end ? before - moved.length : before;
  out.splice(at, 0, ...moved);
  return out;
}

export interface MoveEdit {
  /** Replace [from, to) with `insert`. */
  from: number;
  to: number;
  insert: string;
  /** End of the moved row in the result, where the caret belongs. */
  head: number;
}

const offsetOf = (lines: readonly string[], index: number): number =>
  lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);

/**
 * The same move as one edit covering only the lines between where the block
 * was and where it lands. Everything outside that stretch is left untouched,
 * so positions there -- a focus anchor, the undo history's view of the text --
 * carry straight through it.
 */
export function moveEdit(doc: string, block: Block, before: number): MoveEdit | null {
  const lines = doc.split("\n");
  const moved = moveBlock(lines, block, before);
  if (!moved) return null;

  const lo = Math.min(block.start, before);
  const hi = Math.max(block.end + 1, before);
  const from = offsetOf(lines, lo);
  const to = offsetOf(lines, hi) - 1;

  const size = block.end - block.start + 1;
  const landed = before > block.end ? before - size : before;
  const head = from + offsetOf(moved.slice(lo), landed - lo) + moved[landed]!.length;

  return { from, to, insert: moved.slice(lo, hi).join("\n"), head };
}
