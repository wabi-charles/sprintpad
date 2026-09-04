import type { EditorState, Line, TransactionSpec } from "@codemirror/state";
import { HEADER_MARKER, indentTextFor, markerFor, parseLine } from "./grammar";
import { pendingTaskLine, setPendingTask } from "./pendingTask";

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
 * Enter, behaving like a bullet list: it opens a fresh task and shows you the
 * waiting checkbox. Pressing it again on that empty task steps back out --
 * one indent level at a time, and at the left margin it drops the checkbox
 * and leaves you on a plain blank line.
 *
 * A blank line that is *not* the pending one is ordinary whitespace, so Enter
 * there does what Enter does in any text editor.
 */
export function newTaskLine(state: EditorState): TransactionSpec | null {
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || !range.empty) return null;

  const line = state.doc.lineAt(range.head);
  const parsed = parseLine(line.text);

  if (line.text.trim() === "") {
    if (pendingTaskLine(state) !== line.from) return null;

    if (parsed.indent === 0) {
      return { effects: setPendingTask.of(null) };
    }
    const indent = indentTextFor(parsed.indent - 1);
    return {
      changes: { from: line.from, to: line.to, insert: indent },
      selection: { anchor: line.from + indent.length },
      effects: setPendingTask.of(line.from),
    };
  }

  const offset = range.head - line.from;
  // Inside or before the marker, Enter should just push the line down.
  if (offset <= parsed.markerTo && parsed.markerTo > 0) return null;
  if (offset < parsed.indentText.length) return null;

  const indent = indentTextFor(parsed.indent);
  const opensEmptyLine = line.text.slice(offset).trim() === "";
  return {
    changes: { from: range.head, insert: `\n${indent}` },
    selection: { anchor: range.head + 1 + indent.length },
    effects: opensEmptyLine ? setPendingTask.of(range.head + 1) : undefined,
  };
}

/**
 * Backspace at the head of a line, where the markers are invisible.
 *
 * A hidden `[x] ` or `# ` is several characters wide, so plain backspace eats
 * it one at a time through states that render as nothing changing. One press
 * removes the whole marker and leaves an ordinary open task.
 *
 * The same applies to indentation: half a level is not a state worth stopping
 * in, so one press removes a whole level.
 */
export function backspaceAtLineHead(state: EditorState): TransactionSpec | null {
  const range = state.selection.main;
  if (state.selection.ranges.length > 1 || !range.empty) return null;

  const line = state.doc.lineAt(range.head);
  const parsed = parseLine(line.text);
  const offset = range.head - line.from;

  // On an unindented line the marker is invisible, so the caret slots before
  // and after it sit at the same place on screen -- a click at the head of the
  // text can land on either. Both have to unwrap, or backspace would sometimes
  // silently join lines instead.
  const atMarkerHead = parsed.markerFrom === 0 ? offset >= 0 : offset > parsed.markerFrom;
  if (parsed.markerTo > parsed.markerFrom && atMarkerHead && offset <= parsed.markerTo) {
    return { changes: { from: line.from + parsed.markerFrom, to: line.from + parsed.markerTo } };
  }

  if (offset > 0 && offset <= parsed.indentText.length) {
    const insert = indentTextFor(parsed.indent - 1);
    if (insert === parsed.indentText) return null;
    return {
      changes: { from: line.from, to: line.from + parsed.indentText.length, insert },
      selection: { anchor: line.from + insert.length },
    };
  }

  return null;
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
 *
 * A single empty line still indents -- that is a task you just opened with
 * Enter and want nested. Blank lines inside a multi-line selection are left
 * alone, so indenting a block does not fill its spacers with whitespace.
 */
export function changeIndent(state: EditorState, delta: number): TransactionSpec | null {
  const lines = touchedLines(state);
  const changes = [];
  // On an empty line the cursor sits exactly where the indent is inserted, so
  // it has to be placed explicitly -- otherwise it is left stranded to the
  // left of the whitespace and the next character typed lands before it.
  let caret: number | null = null;

  for (const line of lines) {
    const parsed = parseLine(line.text);
    if (parsed.kind === "blank" && lines.length > 1) continue;
    const insert = indentTextFor(parsed.indent + delta);
    if (insert === parsed.indentText) continue;
    if (parsed.kind === "blank") caret = line.from + insert.length;
    changes.push({ from: line.from, to: line.from + parsed.indentText.length, insert });
  }

  if (changes.length === 0) return null;
  return caret === null ? { changes } : { changes, selection: { anchor: caret } };
}

/**
 * The tasks a focus session would cover: every task line the selection
 * touches, or just the cursor's line when nothing is selected. Headers, blanks
 * and empty tasks are skipped, so selecting a whole section focuses its work
 * and not its heading.
 */
export function focusTargetsIn(state: EditorState): TaskTarget[] {
  const targets: TaskTarget[] = [];
  const seen = new Set<number>();

  for (const line of touchedLines(state)) {
    if (seen.has(line.from)) continue;
    const target = targetOf(line);
    if (!target) continue;
    seen.add(line.from);
    targets.push(target);
  }

  return targets;
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
 * Palette action. Headers are the one thing bare typing cannot produce, so
 * this is the discoverable route to them alongside typing `# `.
 */
export function toggleHeader(state: EditorState): TransactionSpec | null {
  const lines = touchedLines(state)
    .map((line) => ({ line, parsed: parseLine(line.text) }))
    .filter(({ parsed }) => parsed.kind !== "blank");
  if (lines.length === 0) return null;

  const toHeader = !lines.every(({ parsed }) => parsed.kind === "header");
  const changes = lines
    .filter(({ parsed }) => (parsed.kind === "header") !== toHeader)
    .map(({ line, parsed }) => ({
      from: line.from + parsed.markerFrom,
      to: line.from + parsed.markerTo,
      insert: toHeader ? HEADER_MARKER : "",
    }));

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
