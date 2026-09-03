import { moveLineDown, moveLineUp } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { changeIndent, toggleDone } from "./edits";
import {
  anchorForLine,
  anchoredLine,
  focusAnchorField,
  reanchorTo,
  resolveFocusedLine,
  setFocusAnchor,
} from "./focusField";
import { parseLine } from "./grammar";

const DOC = "TODAY\n[] first\n[] focused\n[] third";

/** A state focused on the "focused" task, with the cursor on that line too. */
function focusedState(doc = DOC, taskText = "focused"): EditorState {
  const base = EditorState.create({ doc, extensions: [focusAnchorField] });
  let lineNumber = 1;
  for (let n = 1; n <= base.doc.lines; n++) {
    if (parseLine(base.doc.line(n).text).text.trim() === taskText) lineNumber = n;
  }
  const line = base.doc.line(lineNumber);
  return base.update({
    effects: setFocusAnchor.of(anchorForLine(line)),
    selection: { anchor: line.to },
  }).state;
}

/** The task text the anchor currently points at. */
function focusedText(state: EditorState): string | null {
  const line = anchoredLine(state);
  return line ? parseLine(line.text).text.trim() : null;
}

function runCommand(state: EditorState, command: typeof moveLineUp): EditorState {
  let next = state;
  command({
    state,
    dispatch: (tr: Transaction) => {
      next = tr.state;
    },
  } as never);
  return next;
}

describe("focus anchor", () => {
  it("tracks the task it was set on", () => {
    expect(focusedText(focusedState())).toBe("focused");
  });

  it("follows text inserted above it", () => {
    const state = focusedState();
    const next = state.update({ changes: { from: 0, insert: "NEW HEADER\n[] added\n" } }).state;
    expect(focusedText(next)).toBe("focused");
  });

  it("is unmoved by edits below it", () => {
    const state = focusedState();
    const next = state.update({ changes: { from: state.doc.length, insert: "\n[] later" } }).state;
    expect(focusedText(next)).toBe("focused");
  });

  it("follows the task when it is moved up", () => {
    const moved = runCommand(focusedState(), moveLineUp);
    expect(moved.doc.toString()).toBe("TODAY\n[] focused\n[] first\n[] third");
    expect(focusedText(moved)).toBe("focused");
  });

  it("follows the task when it is moved down", () => {
    const moved = runCommand(focusedState(), moveLineDown);
    expect(moved.doc.toString()).toBe("TODAY\n[] first\n[] third\n[] focused");
    expect(focusedText(moved)).toBe("focused");
  });

  it("keeps hold of the task when a neighbour is moved past it", () => {
    // Moving "third" up rewrites the focused line's text as a side effect, so
    // the raw anchor drops and the title fallback is what carries focus over.
    const state = focusedState();
    const cursorOnThird = state.update({ selection: { anchor: state.doc.length } }).state;
    const moved = runCommand(cursorOnThird, moveLineUp);
    expect(moved.doc.toString()).toBe("TODAY\n[] first\n[] third\n[] focused");
    expect(resolveFocusedLine(moved, "focused")?.text).toBe("[] focused");
  });

  it("survives completing the focused task", () => {
    const state = focusedState();
    const next = state.update(toggleDone(state)!).state;
    expect(next.doc.toString()).toContain("[x] focused");
    expect(focusedText(next)).toBe("focused");
  });

  it("survives indenting the focused task", () => {
    const state = focusedState();
    const next = state.update(changeIndent(state, 1)!).state;
    expect(next.doc.toString()).toContain("  [] focused");
    expect(focusedText(next)).toBe("focused");
  });

  it("follows an edit to the task's own text", () => {
    const state = focusedState();
    const next = state.update({ changes: { from: state.selection.main.head, insert: " harder" } })
      .state;
    expect(focusedText(next)).toBe("focused harder");
  });

  it("drops the anchor when the task line is deleted", () => {
    const state = focusedState();
    const line = anchoredLine(state)!;
    const next = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    expect(next.field(focusAnchorField)).toBeNull();
    expect(focusedText(next)).toBeNull();
  });

  it("is cleared by an explicit effect", () => {
    const next = focusedState().update({ effects: setFocusAnchor.of(null) }).state;
    expect(focusedText(next)).toBeNull();
  });
});

describe("reanchorTo", () => {
  it("re-attaches after the fallback recovered the task", () => {
    const state = focusedState();
    const cursorOnThird = state.update({ selection: { anchor: state.doc.length } }).state;
    const moved = runCommand(cursorOnThird, moveLineUp);

    const anchor = reanchorTo(moved, "focused");
    expect(anchor).not.toBeNull();

    const reattached = moved.update({ effects: setFocusAnchor.of(anchor) }).state;
    expect(focusedText(reattached)).toBe("focused");
    // And tracking works again from there.
    const edited = reattached.update({ changes: { from: 0, insert: "[] added\n" } }).state;
    expect(focusedText(edited)).toBe("focused");
  });

  it("stays quiet while the anchor is healthy", () => {
    expect(reanchorTo(focusedState(), "focused")).toBeNull();
  });

  it("stays quiet when the task is really gone", () => {
    const state = focusedState();
    const line = anchoredLine(state)!;
    const cut = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    expect(reanchorTo(cut, "focused")).toBeNull();
  });
});

describe("resolveFocusedLine", () => {
  it("prefers the anchored line even after the title changed", () => {
    const state = focusedState();
    const renamed = state.update({ changes: { from: state.selection.main.head, insert: " v2" } })
      .state;
    const line = resolveFocusedLine(renamed, "focused")!;
    expect(parseLine(line.text).text).toBe("focused v2");
  });

  it("recovers a cut-and-repasted task by its title", () => {
    const state = focusedState();
    const line = anchoredLine(state)!;
    const cut = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    const repasted = cut.update({ changes: { from: cut.doc.length, insert: "\n[] focused" } }).state;
    expect(resolveFocusedLine(repasted, "focused")?.text).toBe("[] focused");
  });

  it("returns null when the task is really gone", () => {
    const state = focusedState();
    const line = anchoredLine(state)!;
    const cut = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    expect(resolveFocusedLine(cut, "focused")).toBeNull();
  });
});
