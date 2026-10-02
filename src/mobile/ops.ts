import { EditorState, type TransactionSpec } from "@codemirror/state";
import { backspaceAtLineHead, newTaskLine, toggleDone } from "../doc/edits";
import { blockOf, moveBlock } from "../doc/blocks";
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
 * The rows that move as one: a task and anything nested under it. The rule
 * itself lives in doc/blocks.ts, shared with the editor's drag handle, so a
 * block is the same thing on a phone as at a desk.
 */
export function blockAt(rows: readonly Row[], index: number): Row[] {
  const block = blockOf(
    rows.map((row) => row.raw),
    index,
  );
  return block ? rows.slice(block.start, block.end + 1) : [];
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
  const lines = doc.split("\n");
  const block = blockOf(lines, index);
  if (!block) return { doc, caret: 0 };

  const moved = moveBlock(lines, block, before);
  // Landing anywhere inside itself is where it already is.
  if (!moved) return { doc, caret: offsetOfLine(doc, block.start) };

  const size = block.end - block.start + 1;
  const at = before > block.end ? before - size : before;
  const next = moved.join("\n");
  return { doc: next, caret: offsetOfLine(next, at) };
}

/**
 * Nest a block one level deeper or shallower, children moving with it.
 *
 * Nothing is refused except going left of the margin. There was a rule here
 * once about not nesting below a task that is not there, which sounded
 * principled and meant the first task under a header could not be indented at
 * all -- while Tab on the desktop indented it happily. Two interfaces over one
 * document do not get to disagree about what the document may contain.
 */
export function shiftBlockDepth(doc: string, index: number, delta: 1 | -1): Applied {
  const rows = rowsFor(doc);
  const block = blockAt(rows, index);
  const head = block[0];
  if (!head || head.kind === "header") return { doc, caret: head?.from ?? 0 };
  if (delta === -1 && head.depth === 0) return { doc, caret: head.from };

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
