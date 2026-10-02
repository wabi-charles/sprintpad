import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { blockOf, moveBlock, moveEdit } from "./blocks";

const LINES = ["# TODAY", "Ship it", "  Write the notes", "    Find the draft", "  Send them", "Call the bank", "", "# LATER", "Read"];

describe("what a row carries", () => {
  it("takes everything indented under it", () => {
    expect(blockOf(LINES, 1)).toEqual({ start: 1, end: 4 });
  });

  it("takes the deeper rows of a subtask, but not its siblings", () => {
    expect(blockOf(LINES, 2)).toEqual({ start: 2, end: 3 });
  });

  it("is just the row when nothing is indented under it", () => {
    expect(blockOf(LINES, 5)).toEqual({ start: 5, end: 5 });
  });

  it("leaves a header's section where it is", () => {
    expect(blockOf(LINES, 0)).toEqual({ start: 0, end: 0 });
  });

  it("does not take the blank line after it", () => {
    expect(blockOf(["Ship it", "  sub", "", "Next"], 0)).toEqual({ start: 0, end: 1 });
  });

  it("keeps a blank line inside the block", () => {
    expect(blockOf(["Ship it", "  sub", "", "  more", "Next"], 0)).toEqual({ start: 0, end: 3 });
  });

  it("stops at the next header even if it is indented under nothing", () => {
    expect(blockOf(["Ship it", "  sub", "# LATER", "  x"], 0)).toEqual({ start: 0, end: 1 });
  });

  it("has nothing past the end", () => {
    expect(blockOf(LINES, 99)).toBeNull();
  });
});

describe("moving a block", () => {
  it("moves a task with its subtasks, keeping their indentation", () => {
    const moved = moveBlock(LINES, { start: 1, end: 4 }, 6);
    expect(moved).toEqual(["# TODAY", "Call the bank", "Ship it", "  Write the notes", "    Find the draft", "  Send them", "", "# LATER", "Read"]);
  });

  it("moves upward too", () => {
    const moved = moveBlock(LINES, { start: 5, end: 5 }, 1);
    expect(moved?.slice(0, 3)).toEqual(["# TODAY", "Call the bank", "Ship it"]);
  });

  it("carries a block into another section", () => {
    const moved = moveBlock(LINES, { start: 5, end: 5 }, 9);
    expect(moved?.slice(-2)).toEqual(["Read", "Call the bank"]);
  });

  it("is a no-op when dropped where it already is", () => {
    expect(moveBlock(LINES, { start: 1, end: 4 }, 1)).toBeNull();
    expect(moveBlock(LINES, { start: 1, end: 4 }, 3)).toBeNull();
    expect(moveBlock(LINES, { start: 1, end: 4 }, 5)).toBeNull();
  });

  it("never loses or invents a line", () => {
    const moved = moveBlock(LINES, { start: 1, end: 4 }, 9)!;
    expect([...moved].sort()).toEqual([...LINES].sort());
  });
});

/**
 * The edit has to produce exactly the moved text, and touch only the stretch
 * between the old place and the new one.
 */
describe("the move as one edit", () => {
  const DOC = LINES.join("\n");

  function apply(block: { start: number; end: number }, before: number) {
    const edit = moveEdit(DOC, block, before)!;
    const state = EditorState.create({ doc: DOC });
    const next = state.update({ changes: { from: edit.from, to: edit.to, insert: edit.insert } }).state;
    return { edit, text: next.doc.toString() };
  }

  it("produces the same text as the line move, downward and upward", () => {
    for (const [block, before] of [
      [{ start: 1, end: 4 }, 6],
      [{ start: 5, end: 5 }, 1],
      [{ start: 5, end: 5 }, 9],
      [{ start: 2, end: 3 }, 0],
    ] as const) {
      expect(apply(block, before).text).toBe(moveBlock(LINES, block, before)!.join("\n"));
    }
  });

  it("leaves the lines outside the stretch alone", () => {
    const { edit } = apply({ start: 5, end: 5 }, 1);
    expect(DOC.slice(0, edit.from)).toBe("# TODAY\n");
    expect(DOC.slice(edit.to)).toBe("\n\n# LATER\nRead");
  });

  it("puts the caret at the end of the moved row", () => {
    const { edit, text } = apply({ start: 1, end: 4 }, 6);
    expect(text.slice(0, edit.head).endsWith("Call the bank\nShip it")).toBe(true);
  });

  it("drops a single row at the very end of the document", () => {
    const { edit, text } = apply({ start: 5, end: 5 }, LINES.length);
    expect(text.endsWith("Read\nCall the bank")).toBe(true);
    expect(text.slice(0, edit.head).endsWith("Call the bank")).toBe(true);
  });

  it("drops a row with its subtasks at the very end of the document", () => {
    const { edit, text } = apply({ start: 1, end: 4 }, LINES.length);
    expect(text.endsWith("Read\nShip it\n  Write the notes\n    Find the draft\n  Send them")).toBe(true);
    expect(text.slice(0, edit.head).endsWith("Read\nShip it")).toBe(true);
  });

  it("refuses a move that goes nowhere", () => {
    expect(moveEdit(DOC, { start: 1, end: 4 }, 2)).toBeNull();
  });
});
