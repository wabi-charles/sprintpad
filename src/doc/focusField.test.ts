import { moveLineDown, moveLineUp } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { changeIndent, toggleDone } from "./edits";
import {
  anchorForLine,
  anchoredLines,
  focusAnchorsField,
  reanchorTo,
  resolveFocusedLines,
  setFocusAnchors,
} from "./focusField";
import { parseLine } from "./grammar";

const DOC = "# TODAY\nfirst\nfocused\nthird";

/** A state focused on the named tasks, cursor on the last of them. */
function focusedState(titles: string[] = ["focused"], doc = DOC): EditorState {
  const base = EditorState.create({ doc, extensions: [focusAnchorsField] });
  const lines = [];
  for (let n = 1; n <= base.doc.lines; n++) {
    const line = base.doc.line(n);
    if (titles.includes(parseLine(line.text).text.trim())) lines.push(line);
  }
  return base.update({
    effects: setFocusAnchors.of(lines.map(anchorForLine)),
    selection: { anchor: lines[lines.length - 1]!.to },
  }).state;
}

/** The task texts the anchors currently point at. */
function focusedTexts(state: EditorState): string[] {
  return anchoredLines(state).map((line) => parseLine(line.text).text.trim());
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

describe("a single focused task", () => {
  it("tracks the task it was set on", () => {
    expect(focusedTexts(focusedState())).toEqual(["focused"]);
  });

  it("follows text inserted above it", () => {
    const state = focusedState();
    const next = state.update({ changes: { from: 0, insert: "# NEW\nadded\n" } }).state;
    expect(focusedTexts(next)).toEqual(["focused"]);
  });

  it("is unmoved by edits below it", () => {
    const state = focusedState();
    const next = state.update({ changes: { from: state.doc.length, insert: "\nlater" } }).state;
    expect(focusedTexts(next)).toEqual(["focused"]);
  });

  it("follows the task when it is moved up or down", () => {
    const up = runCommand(focusedState(), moveLineUp);
    expect(up.doc.toString()).toBe("# TODAY\nfocused\nfirst\nthird");
    expect(focusedTexts(up)).toEqual(["focused"]);

    const down = runCommand(focusedState(), moveLineDown);
    expect(down.doc.toString()).toBe("# TODAY\nfirst\nthird\nfocused");
    expect(focusedTexts(down)).toEqual(["focused"]);
  });

  it("keeps hold of the task when a neighbour is moved past it", () => {
    // Moving "third" up rewrites the focused line's text as a side effect, so
    // the raw anchor drops and the title fallback is what carries focus over.
    const state = focusedState();
    const cursorOnThird = state.update({ selection: { anchor: state.doc.length } }).state;
    const moved = runCommand(cursorOnThird, moveLineUp);
    expect(moved.doc.toString()).toBe("# TODAY\nfirst\nthird\nfocused");
    // The anchor must drop rather than slide onto the task that took its
    // place -- pointing at the wrong task is worse than losing the position.
    expect(focusedTexts(moved)).toEqual([]);
    expect(resolveFocusedLines(moved, ["focused"]).map((l) => l.text)).toEqual(["focused"]);
  });

  it("survives completing and indenting the focused task", () => {
    const completed = focusedState();
    const done = completed.update(toggleDone(completed)!).state;
    expect(done.doc.toString()).toContain("[x] focused");
    expect(focusedTexts(done)).toEqual(["focused"]);

    const indented = focusedState();
    const nested = indented.update(changeIndent(indented, 1)!).state;
    expect(nested.doc.toString()).toContain("  focused");
    expect(focusedTexts(nested)).toEqual(["focused"]);
  });

  it("follows an edit to the task's own text", () => {
    const state = focusedState();
    const next = state.update({ changes: { from: state.selection.main.head, insert: " harder" } })
      .state;
    expect(focusedTexts(next)).toEqual(["focused harder"]);
  });

  it("drops the anchor when the task line is deleted", () => {
    const state = focusedState();
    const line = anchoredLines(state)[0]!;
    const next = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    expect(next.field(focusAnchorsField)).toEqual([]);
  });

  it("is cleared by an explicit effect", () => {
    expect(focusedTexts(focusedState().update({ effects: setFocusAnchors.of([]) }).state)).toEqual([]);
  });
});

describe("a focused group", () => {
  it("tracks every task in the group, in document order", () => {
    expect(focusedTexts(focusedState(["first", "third"]))).toEqual(["first", "third"]);
  });

  it("keeps the group together when one member moves", () => {
    const state = focusedState(["first", "third"]);
    const onFirst = state.update({ selection: { anchor: 13 } }).state;
    const moved = runCommand(onFirst, moveLineDown);
    expect(moved.doc.toString()).toBe("# TODAY\nfocused\nfirst\nthird");
    expect(focusedTexts(moved)).toEqual(["first", "third"]);
  });

  it("drops only the member that was deleted", () => {
    const state = focusedState(["first", "third"]);
    const line = anchoredLines(state)[0]!;
    const next = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    expect(focusedTexts(next)).toEqual(["third"]);
  });

  it("re-derives the whole group once any anchor is lost", () => {
    const state = focusedState(["first", "third"]);
    const partial = state.update({ effects: setFocusAnchors.of([anchorForLine(state.doc.line(2))]) })
      .state;
    expect(resolveFocusedLines(partial, ["first", "third"]).map((l) => l.text)).toEqual([
      "first",
      "third",
    ]);
  });

  it("does not match one title to two lines", () => {
    const state = focusedState(["first"], "# TODAY\nfirst\nfirst");
    expect(resolveFocusedLines(state, ["first", "first"]).map((l) => l.from)).toEqual([8, 14]);
  });
});

describe("reanchorTo", () => {
  it("re-attaches after the fallback recovered the group", () => {
    const state = focusedState();
    const cursorOnThird = state.update({ selection: { anchor: state.doc.length } }).state;
    const moved = runCommand(cursorOnThird, moveLineUp);

    const anchors = reanchorTo(moved, ["focused"]);
    expect(anchors).not.toBeNull();

    const reattached = moved.update({ effects: setFocusAnchors.of(anchors!) }).state;
    expect(focusedTexts(reattached)).toEqual(["focused"]);
    // And tracking works again from there.
    const edited = reattached.update({ changes: { from: 0, insert: "added\n" } }).state;
    expect(focusedTexts(edited)).toEqual(["focused"]);
  });

  it("stays quiet while the anchors are healthy", () => {
    expect(reanchorTo(focusedState(), ["focused"])).toBeNull();
    expect(reanchorTo(focusedState(["first", "third"]), ["first", "third"])).toBeNull();
  });

  it("stays quiet when the task is really gone", () => {
    const state = focusedState();
    const line = anchoredLines(state)[0]!;
    const cut = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    expect(reanchorTo(cut, ["focused"])).toBeNull();
  });
});

describe("resolveFocusedLines", () => {
  it("prefers the anchored lines even after a title changed", () => {
    const state = focusedState();
    const renamed = state.update({ changes: { from: state.selection.main.head, insert: " v2" } })
      .state;
    expect(resolveFocusedLines(renamed, ["focused"]).map((l) => l.text)).toEqual(["focused v2"]);
  });

  it("recovers a cut-and-repasted task by its title", () => {
    const state = focusedState();
    const line = anchoredLines(state)[0]!;
    const cut = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    const repasted = cut.update({ changes: { from: cut.doc.length, insert: "\nfocused" } }).state;
    expect(resolveFocusedLines(repasted, ["focused"]).map((l) => l.text)).toEqual(["focused"]);
  });

  it("returns nothing when the task is really gone", () => {
    const state = focusedState();
    const line = anchoredLines(state)[0]!;
    const cut = state.update({ changes: { from: line.from - 1, to: line.to } }).state;
    expect(resolveFocusedLines(cut, ["focused"])).toEqual([]);
  });
});
