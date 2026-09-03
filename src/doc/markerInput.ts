import { StateEffect, StateField, type Transaction } from "@codemirror/state";

/**
 * Old habits type `[]` at the start of a task. The line is already a task, so
 * those keystrokes are ceremony -- and half-typed, they show up as literal
 * text next to the checkbox.
 *
 * So we absorb them at the very start of an empty task. Pressing `[` a second
 * time types the real character, which is the escape hatch for a task that
 * genuinely starts with a bracket.
 */

/** The prefixes worth absorbing: what the marker used to look like. */
const CEREMONY = ["[] ", "[ ] "];

export interface SwallowedMarker {
  /** Cursor position the run started at; it never moves while absorbing. */
  pos: number;
  /** What has been absorbed so far, e.g. "[" or "[]". */
  consumed: string;
}

export type MarkerInputAction =
  | { kind: "swallow"; consumed: string }
  | { kind: "literal" }
  | null;

export interface LineLike {
  from: number;
  to: number;
  text: string;
}

/**
 * Decides what a single typed character should do. Pure, so the rules can be
 * read and tested without an editor.
 */
export function markerInputAction(
  line: LineLike,
  pos: number,
  typed: string,
  swallowed: SwallowedMarker | null,
): MarkerInputAction {
  const active = swallowed && swallowed.pos === pos ? swallowed : null;

  // Second `[` in a row: the user means the character.
  if (typed === "[" && active?.consumed === "[") return { kind: "literal" };

  // Only at the head of a task that has no text yet.
  if (line.text.trim() !== "" || pos !== line.to) return null;

  const candidate = (active?.consumed ?? "") + typed;
  if (!CEREMONY.some((form) => form.startsWith(candidate))) return null;
  return { kind: "swallow", consumed: candidate };
}

export const setSwallowedMarker = StateEffect.define<SwallowedMarker | null>();

export const swallowedMarkerField = StateField.define<SwallowedMarker | null>({
  create: () => null,

  update(value, tr: Transaction) {
    for (const effect of tr.effects) {
      if (effect.is(setSwallowedMarker)) return effect.value;
    }
    // A run only spans consecutive absorbed keystrokes; anything else ends it.
    if (value === null) return null;
    if (tr.docChanged || tr.newSelection.main.head !== value.pos) return null;
    return value;
  },
});
