import { EditorState, type TransactionSpec } from "@codemirror/state";
import { backspaceAtLineHead, changeIndent, newTaskLine, toggleDone } from "../doc/edits";
import { parseLine } from "../doc/grammar";
import { rowsFor, type Row } from "./rows";

/**
 * What a tap or a swipe does to the document.
 *
 * `doc/edits.ts` imports CodeMirror for types only -- it is pure logic over an
 * EditorState -- so the phone runs the very same functions the editor does
 * rather than a second implementation of the same rules. Ticking a task here
 * and ticking it at a desk are literally the same code path, which is the only
 * way two interfaces over one document stay honest.
 *
 * The exceptions are the two things a keyboard has no gesture for -- deleting
 * a row outright, and dragging one with its children -- which are written
 * here and tested here.
 */

export interface Applied {
  doc: string;
  /** Where the caret belongs afterwards, as a character offset. */
  caret: number;
}

function apply(
  doc: string,
  position: number,
  produce: (state: EditorState) => TransactionSpec | null,
): Applied {
  const state = EditorState.create({ doc, selection: { anchor: Math.min(position, doc.length) } });
  const spec = produce(state);
  if (!spec) return { doc, caret: position };
  const next = state.update(spec);
  return { doc: next.state.doc.toString(), caret: next.state.selection.main.head };
}

export function toggleDoneAt(doc: string, position: number): Applied {
  return apply(doc, position, toggleDone);
}

export function indentAt(doc: string, position: number, delta: 1 | -1): Applied {
  return apply(doc, position, (state) => changeIndent(state, delta));
}

export function newTaskAt(doc: string, position: number): Applied {
  return apply(doc, position, newTaskLine);
}

export function backspaceAt(doc: string, position: number): Applied {
  return apply(doc, position, backspaceAtLineHead);
}

/** Replace a row's visible text, leaving its indent and marker alone. */
export function setTextAt(doc: string, row: Row, text: string): Applied {
  const parsed = parseLine(row.raw);
  const head = row.raw.slice(0, parsed.markerTo === -1 ? row.raw.length : parsed.markerTo);
  const raw = parsed.kind === "blank" ? text : head + text;

  const before = doc.slice(0, row.from);
  const after = doc.slice(row.to);
  return { doc: before + raw + after, caret: row.from + raw.length };
}

/**
 * The rows that move as one: a task and anything nested under it.
 *
 * A keyboard moves the line the cursor is on, which is right when you can see
 * the cursor. A finger drags a thing, and a task with subtasks is one thing --
 * leaving the children behind would read as a bug.
 */
export function blockAt(rows: readonly Row[], index: number): Row[] {
  const first = rows[index];
  if (!first) return [];

  const block = [first];
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === "header") break;
    if (row.kind !== "blank" && row.depth <= first.depth) break;
    block.push(row);
  }

  // A trailing blank belongs to whatever came before it, not to the move.
  while (block.length > 1 && block[block.length - 1]!.kind === "blank") block.pop();
  return block;
}

export function deleteRowAt(doc: string, index: number): Applied {
  const rows = rowsFor(doc);
  const block = blockAt(rows, index);
  if (block.length === 0) return { doc, caret: 0 };

  const first = block[0]!;
  const last = block[block.length - 1]!;
  // Take the newline that follows, or the one before it when this is the last
  // line, so deleting never leaves an empty row behind.
  const cutFrom = last.to < doc.length ? first.from : Math.max(0, first.from - 1);
  const cutTo = last.to < doc.length ? last.to + 1 : last.to;

  return { doc: doc.slice(0, cutFrom) + doc.slice(cutTo), caret: cutFrom };
}

/**
 * Move a row, with its children, past the sibling above or below it.
 *
 * Only among siblings: a drag that changed a task's nesting as a side effect
 * of reordering would be a surprise, and indenting is its own gesture. The
 * document comes back unchanged when there is nowhere to go, so a drag at the
 * end of a list is a no-op rather than an error.
 */
export function moveRowAt(doc: string, index: number, delta: 1 | -1): Applied {
  const rows = rowsFor(doc);
  const block = blockAt(rows, index);
  if (block.length === 0) return { doc, caret: 0 };

  const first = block[0]!;
  const last = block[block.length - 1]!;
  const count = last.index - first.index + 1;

  const target =
    delta === -1
      ? siblingBefore(rows, first)
      : siblingAfter(rows, last, first.depth);

  if (target === null) return { doc, caret: first.from };

  const lines = doc.split("\n");
  const moved = lines.splice(first.index, count);
  // Removing the block shifts anything after it up by its own length.
  const at = target > first.index ? target - count + 1 : target;
  lines.splice(at, 0, ...moved);

  const next = lines.join("\n");
  return { doc: next, caret: offsetOfLine(next, at) };
}

/** Index of the head of the sibling block above, or null if there is none. */
function siblingBefore(rows: readonly Row[], first: Row): number | null {
  for (let i = first.index - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.kind === "blank") continue;
    if (row.kind === "header" || row.depth < first.depth) return null;
    if (row.depth > first.depth) continue;
    return i;
  }
  return null;
}

/** Index of the last line of the sibling block below, or null if there is none. */
function siblingAfter(rows: readonly Row[], last: Row, depth: number): number | null {
  let i = last.index + 1;
  while (i < rows.length && rows[i]!.kind === "blank") i++;

  const head = rows[i];
  if (!head || head.kind === "header" || head.depth !== depth) return null;

  const below = blockAt(rows, i);
  return below[below.length - 1]!.index;
}

function offsetOfLine(doc: string, index: number): number {
  const lines = doc.split("\n");
  let offset = 0;
  for (let i = 0; i < index && i < lines.length; i++) offset += lines[i]!.length + 1;
  return offset;
}
