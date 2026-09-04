import { MapMode, StateEffect, StateField, type EditorState, type Line } from "@codemirror/state";
import { parseLine } from "./grammar";

/**
 * A running focus session has to stay attached to its tasks while the list is
 * rewritten and reordered underneath it. Rather than inventing task ids, we
 * lean on CodeMirror: positions mapped through every transaction.
 *
 * Each anchor sits one character into a task's text: past the marker span, so
 * completing or re-indenting the task leaves it alone, but strictly inside the
 * line, so anything that deletes the line -- including CodeMirror rewriting it
 * to move a neighbour past -- makes TrackDel yield null instead of silently
 * sliding the anchor onto whichever task takes its place.
 */

export const setFocusAnchors = StateEffect.define<number[]>();

export const focusAnchorsField = StateField.define<number[]>({
  create: () => [],

  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusAnchors)) return effect.value;
    }
    if (value.length === 0 || !tr.docChanged) return value;

    const mapped: number[] = [];
    let changed = false;
    for (const pos of value) {
      const next = tr.changes.mapPos(pos, 1, MapMode.TrackDel);
      if (next === null) {
        changed = true;
        continue;
      }
      if (next !== pos) changed = true;
      mapped.push(next);
    }
    return changed ? mapped : value;
  },
});

/** The anchor position for a task line: one character into its text. */
export function anchorForLine(line: Line): number {
  const parsed = parseLine(line.text);
  return line.from + parsed.markerTo + (parsed.text.length > 0 ? 1 : 0);
}

/** The anchored lines that are still tasks, in document order. */
export function anchoredLines(state: EditorState): Line[] {
  const anchors = state.field(focusAnchorsField, false) ?? [];
  const lines: Line[] = [];
  const seen = new Set<number>();

  for (const anchor of anchors) {
    if (anchor > state.doc.length) continue;
    const line = state.doc.lineAt(anchor);
    if (seen.has(line.from)) continue;
    if (parseLine(line.text).kind !== "task") continue;
    seen.add(line.from);
    lines.push(line);
  }

  return lines.sort((a, b) => a.from - b.from);
}

function findTask(state: EditorState, text: string, taken: Set<number>): Line | null {
  const wanted = text.trim();
  if (wanted === "") return null;

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (taken.has(line.from)) continue;
    const parsed = parseLine(line.text);
    if (parsed.kind === "task" && parsed.text.trim() === wanted) return line;
  }
  return null;
}

/**
 * Where the focused tasks live now. Falls back to the titles captured at
 * session start. The fallback is not an edge case: moving a *neighbouring*
 * line past a focused one makes CodeMirror delete and reinsert its text, which
 * legitimately drops the anchor. Losing any anchor re-derives the whole group,
 * which keeps titles and lines from drifting out of correspondence.
 */
export function resolveFocusedLines(state: EditorState, titles: readonly string[]): Line[] {
  const anchored = anchoredLines(state);
  if (anchored.length === titles.length) return anchored;

  const lines: Line[] = [];
  const taken = new Set<number>();
  for (const title of titles) {
    const line = findTask(state, title, taken);
    if (!line) continue;
    taken.add(line.from);
    lines.push(line);
  }
  return lines.sort((a, b) => a.from - b.from);
}

/**
 * The anchors to re-attach after the fallback recovered the group, or null
 * when nothing needs to change. Callers dispatch this so that once focus is
 * found again by title, subsequent edits are tracked by position as usual.
 */
export function reanchorTo(state: EditorState, titles: readonly string[]): number[] | null {
  if (anchoredLines(state).length === titles.length) return null;
  const lines = resolveFocusedLines(state, titles);
  if (lines.length === 0) return null;
  return lines.map(anchorForLine);
}
