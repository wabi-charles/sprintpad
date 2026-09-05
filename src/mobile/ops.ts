import { EditorState, type TransactionSpec } from "@codemirror/state";
import { backspaceAtLineHead, newTaskLine, toggleDone } from "../doc/edits";
import { indentTextFor, parseLine } from "../doc/grammar";
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
 * The exceptions are the things a keyboard has no gesture for -- deleting a
 * row outright, and dragging one with its children to somewhere else -- which
 * are written here and tested here.
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

function offsetOfLine(doc: string, index: number): number {
  const lines = doc.split("\n");
  let offset = 0;
  for (let i = 0; i < index && i < lines.length; i++) offset += lines[i]!.length + 1;
  return offset;
}

/**
 * Drop a block before a given line, anywhere in the document.
 *
 * Dragging is not nudging. A key moves a task among its siblings because that
 * is all you can see yourself doing; a finger carries it wherever it is put --
 * into another section, out from under its parent -- and refusing that mid-drag
 * would feel broken. Nesting is the horizontal axis of the same gesture, so it
 * is not decided here.
 */
export function moveBlockTo(doc: string, index: number, before: number): Applied {
  const rows = rowsFor(doc);
  const block = blockAt(rows, index);
  if (block.length === 0) return { doc, caret: 0 };

  const start = block[0]!.index;
  const count = block[block.length - 1]!.index - start + 1;
  // Landing anywhere inside itself is where it already is.
  if (before >= start && before <= start + count) return { doc, caret: block[0]!.from };

  const lines = doc.split("\n");
  const moved = lines.splice(start, count);
  const at = before > start ? before - count : before;
  lines.splice(at, 0, ...moved);

  const next = lines.join("\n");
  return { doc: next, caret: offsetOfLine(next, at) };
}

/**
 * Nest a block one level deeper or shallower, children moving with it.
 *
 * A task cannot be more than one level below the task above it, or the outline
 * would describe a parent that is not there.
 */
export function shiftBlockDepth(doc: string, index: number, delta: 1 | -1): Applied {
  const rows = rowsFor(doc);
  const block = blockAt(rows, index);
  const head = block[0];
  if (!head || head.kind === "header") return { doc, caret: head?.from ?? 0 };
  if (delta === -1 && head.depth === 0) return { doc, caret: head.from };

  if (delta === 1) {
    const above = [...rows.slice(0, head.index)].reverse().find((row) => row.kind === "task");
    if (!above || head.depth > above.depth) return { doc, caret: head.from };
  }

  const lines = doc.split("\n");
  for (const row of block) {
    if (row.kind === "blank") continue;
    const parsed = parseLine(row.raw);
    lines[row.index] =
      indentTextFor(Math.max(0, parsed.indent + delta)) + row.raw.slice(parsed.indentText.length);
  }

  const next = lines.join("\n");
  return { doc: next, caret: offsetOfLine(next, head.index) };
}
