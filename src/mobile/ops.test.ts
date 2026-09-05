import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { changeIndent, toggleDone } from "../doc/edits";
import {
  blockAt,
  deleteRowAt,
  moveBlockTo,
  newTaskAt,
  setTextAt,
  shiftBlockDepth,
  toggleDoneAt,
} from "./ops";
import { rowsFor } from "./rows";

const DOC = ["# TODAY", "Ship it", "  A subtask", "Call the bank", "Buy milk"].join("\n");

function rowNamed(doc: string, text: string) {
  const row = rowsFor(doc).find((r) => r.text === text);
  if (!row) throw new Error(`no row "${text}"`);
  return row;
}

describe("acting on a row", () => {
  it("completes a task", () => {
    const { doc } = toggleDoneAt(DOC, rowNamed(DOC, "Ship it").from);
    expect(doc).toContain("[x] Ship it");
    expect(doc).toContain("  A subtask");
  });

  it("nests and un-nests", () => {
    const nested = shiftBlockDepth(DOC, rowNamed(DOC, "Call the bank").index, 1).doc;
    expect(nested).toContain("  Call the bank");
    expect(shiftBlockDepth(nested, rowNamed(nested, "Call the bank").index, -1).doc).toBe(DOC);
  });

  it("renames without disturbing the marker or the indent", () => {
    const doc = "  [x] A subtask";
    const { doc: renamed } = setTextAt(doc, rowsFor(doc)[0]!, "Something else");
    expect(renamed).toBe("  [x] Something else");
  });

  it("opens a new task after the one given", () => {
    const row = rowNamed(DOC, "Ship it");
    const { doc, caret } = newTaskAt(DOC, row.to);
    expect(doc.split("\n")[2]).toBe("");
    expect(caret).toBe(row.to + 1);
  });
});

describe("what a keyboard has no gesture for", () => {
  it("takes a task's children with it when deleting", () => {
    const { doc } = deleteRowAt(DOC, rowNamed(DOC, "Ship it").index);
    expect(doc).not.toContain("Ship it");
    expect(doc).not.toContain("A subtask");
    expect(doc).toContain("Call the bank");
  });

  it("deletes a leaf without touching its neighbours", () => {
    const { doc } = deleteRowAt(DOC, rowNamed(DOC, "Call the bank").index);
    expect(doc.split("\n")).toEqual(["# TODAY", "Ship it", "  A subtask", "Buy milk"]);
  });

  it("leaves no empty row behind when deleting the last line", () => {
    const { doc } = deleteRowAt(DOC, rowNamed(DOC, "Buy milk").index);
    expect(doc.endsWith("\n")).toBe(false);
    expect(doc.split("\n")).toHaveLength(4);
  });

  it("groups a task with everything nested under it", () => {
    const rows = rowsFor(DOC);
    const block = blockAt(rows, rowNamed(DOC, "Ship it").index);
    expect(block.map((r) => r.text)).toEqual(["Ship it", "A subtask"]);
  });

  it("carries a task's children along when it is dragged", () => {
    const { doc } = moveBlockTo(DOC, rowNamed(DOC, "Ship it").index, 4);
    expect(doc.split("\n")).toEqual([
      "# TODAY",
      "Call the bank",
      "Ship it",
      "  A subtask",
      "Buy milk",
    ]);
  });

  it("drops a task into another section, which a keyboard would not", () => {
    const doc = ["# TODAY", "Ship it", "# BACKLOG", "Later"].join("\n");
    // A finger can carry a task anywhere it is put; refusing mid-drag would
    // read as the app being broken rather than principled.
    const moved = moveBlockTo(doc, 3, 1).doc;
    expect(moved.split("\n")).toEqual(["# TODAY", "Later", "Ship it", "# BACKLOG"]);
  });

  it("treats a drop inside the block itself as staying put", () => {
    const index = rowNamed(DOC, "Ship it").index;
    expect(moveBlockTo(DOC, index, index).doc).toBe(DOC);
    expect(moveBlockTo(DOC, index, index + 1).doc).toBe(DOC);
  });

  it("nests a whole block, children keeping their relative depth", () => {
    const doc = ["# TODAY", "First", "Second", "  Second's child"].join("\n");
    const { doc: nested } = shiftBlockDepth(doc, rowNamed(doc, "Second").index, 1);
    expect(nested.split("\n")).toEqual(["# TODAY", "First", "  Second", "    Second's child"]);
  });

  it("nests the first task under a header, as Tab does at a desk", () => {
    const { doc } = shiftBlockDepth(DOC, rowNamed(DOC, "Ship it").index, 1);
    expect(doc.split("\n")).toEqual([
      "# TODAY",
      "  Ship it",
      "    A subtask",
      "Call the bank",
      "Buy milk",
    ]);
  });

  it("will not un-nest past the left margin", () => {
    expect(shiftBlockDepth(DOC, rowNamed(DOC, "Buy milk").index, -1).doc).toBe(DOC);
  });
});

/**
 * The guard against two interfaces over one document drifting apart. These run
 * the phone's path and the editor's path over the same text and demand the
 * same answer -- if someone changes one and not the other, this fails.
 */
describe("the phone and the editor agree", () => {
  function throughEditor(
    doc: string,
    at: number,
    edit: (state: EditorState) => ReturnType<typeof toggleDone>,
  ): string {
    const state = EditorState.create({ doc, selection: { anchor: at } });
    const spec = edit(state);
    return spec ? state.update(spec).state.doc.toString() : doc;
  }

  const cases = [
    "# TODAY\nShip it\n  A subtask\nCall the bank",
    "a bare line",
    "[x] already done\nnot done",
    "  indented once\n    indented twice",
    "",
  ];

  it("on completing a task", () => {
    for (const doc of cases) {
      for (const row of rowsFor(doc)) {
        expect(toggleDoneAt(doc, row.from).doc).toBe(throughEditor(doc, row.from, toggleDone));
      }
    }
  });

  it("on nesting a task that has no children", () => {
    for (const doc of cases) {
      const rows = rowsFor(doc);
      for (const row of rows) {
        // Two things are outside the comparison, and both because the phone
        // never offers them: a header is drawn as a section title rather than
        // a row you can grab, and a block with children is the phone's own
        // idea of what a drag carries. Everything a finger can actually do to
        // a task must land in exactly the same place as the editor.
        if (row.kind !== "task") continue;
        if (blockAt(rows, row.index).length !== 1) continue;
        for (const delta of [1, -1] as const) {
          expect(shiftBlockDepth(doc, row.index, delta).doc).toBe(
            throughEditor(doc, row.from, (state) => changeIndent(state, delta)),
          );
        }
      }
    }
  });
});
