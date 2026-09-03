import { MapMode, StateEffect, StateField, type EditorState, type Line } from "@codemirror/state";
import { parseLine } from "./grammar";

/**
 * A running focus session has to stay attached to its task while the list is
 * rewritten and reordered underneath it. Rather than inventing task ids, we
 * lean on CodeMirror: a position mapped through every transaction.
 *
 * The anchor sits on the first character of the task text -- inside the line,
 * but outside the marker span, so completing or re-indenting the task does not
 * disturb it while deleting the line does (TrackDel then yields null).
 */

export const setFocusAnchor = StateEffect.define<number | null>();

export const focusAnchorField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusAnchor)) return effect.value;
    }
    if (value === null || !tr.docChanged) return value;
    return tr.changes.mapPos(value, 1, MapMode.TrackDel);
  },
});

/** The anchor position for a task line: the start of its text. */
export function anchorForLine(line: Line): number {
  return line.from + parseLine(line.text).markerTo;
}

/** The anchored line, if it is still a task. */
export function anchoredLine(state: EditorState): Line | null {
  const anchor = state.field(focusAnchorField, false) ?? null;
  if (anchor === null || anchor > state.doc.length) return null;
  const line = state.doc.lineAt(anchor);
  return parseLine(line.text).kind === "task" ? line : null;
}

/**
 * Where the focused task lives now. Falls back to matching the title captured
 * at session start. The fallback is not an edge case: moving a *neighbouring*
 * line past the focused one makes CodeMirror delete and reinsert the focused
 * line's text, which legitimately drops the anchor.
 */
export function resolveFocusedLine(state: EditorState, snapshotText: string): Line | null {
  const anchored = anchoredLine(state);
  if (anchored) return anchored;

  const wanted = snapshotText.trim();
  if (wanted === "") return null;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const parsed = parseLine(line.text);
    if (parsed.kind === "task" && parsed.text.trim() === wanted) return line;
  }
  return null;
}

/**
 * The anchor to re-attach after the fallback recovered a task, or null when
 * nothing needs to change. Callers dispatch this so that once focus is found
 * again by title, subsequent edits are tracked by position as usual.
 */
export function reanchorTo(state: EditorState, snapshotText: string): number | null {
  if (anchoredLine(state)) return null;
  const line = resolveFocusedLine(state, snapshotText);
  return line ? anchorForLine(line) : null;
}
