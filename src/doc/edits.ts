import type { EditorState, Line, TransactionSpec } from "@codemirror/state";
import { INDENT_UNIT, parseLine, setCompleted, setIndentLevel } from "./grammar";

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
 */
export function toggleDone(state: EditorState): TransactionSpec | null {
  const tasks = touchedLines(state).filter((line) => parseLine(line.text).kind === "task");
  if (tasks.length === 0) return null;

  const completed = !tasks.every((line) => parseLine(line.text).completed);
  const changes = tasks
    .map((line) => ({ from: line.from, to: line.to, insert: setCompleted(line.text, completed) }))
    .filter((change) => change.insert !== state.doc.sliceString(change.from, change.to));

  return changes.length > 0 ? { changes } : null;
}

/** Tab / Shift-Tab. Re-indents in canonical units, normalizing stray tabs. */
export function changeIndent(state: EditorState, delta: number): TransactionSpec | null {
  const changes = [];
  for (const line of touchedLines(state)) {
    const parsed = parseLine(line.text);
    if (parsed.kind === "blank") continue;
    const insert = setIndentLevel(line.text, Math.max(0, parsed.indent + delta));
    if (insert !== line.text) changes.push({ from: line.from, to: line.to, insert });
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
  return { changes: { from: line.from, to: line.to, insert: setCompleted(line.text, true) } };
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
