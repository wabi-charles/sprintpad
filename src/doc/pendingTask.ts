import {
  MapMode,
  StateEffect,
  StateField,
  type EditorState,
  type Transaction,
} from "@codemirror/state";

/**
 * A bullet list shows you an empty bullet the moment you press Enter. Here an
 * empty line is just an empty line -- indistinguishable in the text from the
 * blank spacers between groups -- so "this empty line is a fresh task" has to
 * live in editor state rather than in the document.
 *
 * That keeps the saved text clean: pressing Enter and walking away leaves a
 * plain blank line, not a stray marker.
 */

export const setPendingTask = StateEffect.define<number | null>();

export const pendingTaskField = StateField.define<number | null>({
  create: () => null,

  update(value, tr: Transaction) {
    let next = value;
    let explicit = false;
    for (const effect of tr.effects) {
      if (effect.is(setPendingTask)) {
        next = effect.value;
        explicit = true;
      }
    }
    if (next === null) return null;

    if (!explicit) {
      const mapped = tr.changes.mapPos(next, -1, MapMode.TrackDel);
      if (mapped === null) return null;
      next = mapped;
    }
    if (next > tr.newDoc.length) return null;

    // The placeholder only survives while it is still an empty line with the
    // cursor sitting on it. Typing, or moving away, makes it an ordinary line.
    const line = tr.newDoc.lineAt(next);
    if (line.from !== next || line.text.trim() !== "") return null;

    const cursor = tr.newSelection.main;
    if (!cursor.empty || cursor.head < line.from || cursor.head > line.to) return null;

    return line.from;
  },
});

/** The empty line currently showing a waiting checkbox, if there is one. */
export function pendingTaskLine(state: EditorState): number | null {
  return state.field(pendingTaskField, false) ?? null;
}
