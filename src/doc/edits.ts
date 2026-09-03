import type { EditorState, Line, TransactionSpec } from "@codemirror/state";
import { INDENT_UNIT, indentTextFor, markerFor, parseLine } from "./grammar";

/**
 * Editing logic as pure `(state) -> TransactionSpec | null` functions. Keeping
 * these free of EditorView is what lets the interesting behaviour be tested
 * against a bare EditorState with no DOM; commands.ts wraps them for CodeMirror.
 *
 * Returning null means "we have no opinion" -- the caller lets the editor's
 * default binding run.
 */

export interface TaskTarget {
  /** Document position of the line start. */
  from: number;
  /** Document position of the line end. */
  to: number;
  /** Task text with the marker and indentation stripped. */
  text: string;
  completed: boolean;
}

function touchedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(state.doc.line(n));
    }
  }
  return lines;
}

function targetOf(line: Line): TaskTarget | null {
  const parsed = parseLine(line.text);
  if (parsed.kind !== "task" || parsed.text.trim() === "") return null;
  return { from: line.from, to: line.to, text: parsed.text.trim(), completed: parsed.completed };
}

/**
 * Enter. Continues the list, splits a task at the cursor, or -- on an empty
 * marker -- strips it, which is how you get back out of the list.
 */
export function newTaskLine(state: EditorState): TransactionSpec | null {
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || !range.empty) return null;

  const line = state.doc.lineAt(range.head);
  const parsed = parseLine(line.text);
  if (parsed.kind !== "task") return null;

  if (parsed.text.trim() === "") {
    return {
      changes: { from: line.from, to: line.to, insert: "" },
      selection: { anchor: line.from },
    };
  }

  const offset = range.head - line.from;
  // Inside or before the marker, Enter should just push the line down.
  if (offset <= parsed.markerTo) return null;

  const tail = line.text.slice(offset).replace(/^[ \t]+/, "");
  const prefix = `${INDENT_UNIT.repeat(parsed.indent)}[] `;
  return {
    changes: { from: range.head, to: line.to, insert: `\n${prefix}${tail}` },
    selection: { anchor: range.head + 1 + prefix.length },
  };
}

/**
 * Cmd-D. Completes every task the selection touches; reopens them only when
 * they are already all complete, so a mixed selection resolves to "done".
 *
 * Only the marker span is rewritten, never the whole line -- that keeps a
 * running session's anchor (and the user's selection) attached to the task.
 */
export function toggleDone(state: EditorState): TransactionSpec | null {
  const tasks = touchedLines(state)
    .map((line) => ({ line, parsed: parseLine(line.text) }))
    .filter(({ parsed }) => parsed.kind === "task");
  if (tasks.length === 0) return null;

  const completed = !tasks.every(({ parsed }) => parsed.completed);
  const changes = tasks
    .filter(({ parsed }) => parsed.completed !== completed)
    .map(({ line, parsed }) => ({
      from: line.from + parsed.markerFrom,
      to: line.from + parsed.markerTo,
      insert: markerFor(completed),
    }));

  return changes.length > 0 ? { changes } : null;
}

/**
 * Tab / Shift-Tab. Rewrites only the leading whitespace, normalizing stray
 * tabs to the canonical unit on the way.
 */
export function changeIndent(state: EditorState, delta: number): TransactionSpec | null {
  const changes = [];
  for (const line of touchedLines(state)) {
    const parsed = parseLine(line.text);
    if (parsed.kind === "blank") continue;
    const insert = indentTextFor(parsed.indent + delta);
    if (insert === parsed.indentText) continue;
    changes.push({ from: line.from, to: line.from + parsed.indentText.length, insert });
  }
  return changes.length > 0 ? { changes } : null;
}

/** The task the cursor is sitting on, or null if it is not on one. */
export function focusTargetAt(state: EditorState): TaskTarget | null {
  return targetOf(state.doc.lineAt(state.selection.main.head));
}

/** Marks a specific line complete -- used by the focus panel's DONE button. */
export function completeLineAt(state: EditorState, pos: number): TransactionSpec | null {
  const line = state.doc.lineAt(Math.min(pos, state.doc.length));
  const parsed = parseLine(line.text);
  if (parsed.kind !== "task" || parsed.completed) return null;
  return {
    changes: {
      from: line.from + parsed.markerFrom,
      to: line.from + parsed.markerTo,
      insert: markerFor(true),
    },
  };
}

/**
 * Spec §13: after finishing something, land the cursor on the next thing.
 * Wraps around so the end of the list is never a dead end.
 */
export function nextOpenTaskAfter(state: EditorState, pos: number): TaskTarget | null {
  const total = state.doc.lines;
  const start = state.doc.lineAt(Math.min(pos, state.doc.length)).number;
  for (let step = 1; step <= total; step++) {
    const target = targetOf(state.doc.line(((start - 1 + step) % total) + 1));
    if (target && !target.completed) return target;
  }
  return null;
}

/**
 * Palette action. Typing a bare line leaves a header by design, so this is the
 * explicit way to say "these are tasks" without retyping the markers.
 */
export function convertToTasks(state: EditorState): TransactionSpec | null {
  const changes = [];
  for (const line of touchedLines(state)) {
    const parsed = parseLine(line.text);
    if (parsed.kind !== "header") continue;
    changes.push({
      from: line.from + parsed.indentText.length,
      to: line.from + parsed.indentText.length,
      insert: "[] ",
    });
  }
  return changes.length > 0 ? { changes } : null;
}

/** Palette action. Sweeps finished work out of the way, headers untouched. */
export function clearCompleted(state: EditorState): TransactionSpec | null {
  const end = state.doc.length;
  const ranges: Array<{ from: number; to: number }> = [];

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!parseLine(line.text).completed) continue;
    const from = line.from;
    const to = Math.min(line.to + 1, end);
    // Runs of completed lines merge, which keeps the trailing-newline
    // adjustment below from overlapping the range before it.
    const previous = ranges[ranges.length - 1];
    if (previous && previous.to === from) previous.to = to;
    else ranges.push({ from, to });
  }

  if (ranges.length === 0) return null;

  // A run reaching the end of the document has no trailing newline to consume,
  // so it takes the preceding one instead and leaves no blank line behind.
  const last = ranges[ranges.length - 1]!;
  if (last.to === end && last.from > 0) last.from -= 1;

  return { changes: ranges };
}
