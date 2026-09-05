import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { changeIndent, toggleDone } from "../doc/edits";
import {
  blockAt,
  deleteRowAt,
  indentAt,
  moveRowAt,
  newTaskAt,
  setTextAt,
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

  it("indents and outdents", () => {
    const indented = indentAt(DOC, rowNamed(DOC, "Call the bank").from, 1).doc;
    expect(indented).toContain("  Call the bank");
    expect(indentAt(indented, rowNamed(indented, "Call the bank").from, -1).doc).toBe(DOC);
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

  it("moves a task and its children as one", () => {
    const { doc } = moveRowAt(DOC, rowNamed(DOC, "Call the bank").index, -1);
    expect(doc.split("\n")).toEqual([
      "# TODAY",
      "Call the bank",
      "Ship it",
      "  A subtask",
      "Buy milk",
    ]);
  });

  it("moves down past the whole block below", () => {
    const doc = ["First", "Second", "  Second's child", "Third"].join("\n");
    const { doc: moved } = moveRowAt(doc, 0, 1);
    expect(moved.split("\n")).toEqual(["Second", "  Second's child", "First", "Third"]);
  });

  it("will not move a task out of its section or past a header", () => {
    const first = rowNamed(DOC, "Ship it");
    expect(moveRowAt(DOC, first.index, -1).doc).toBe(DOC);
  });

  it("will not reorder across nesting levels", () => {
    // The subtask has no sibling above it, so there is nowhere to go.
    expect(moveRowAt(DOC, rowNamed(DOC, "A subtask").index, -1).doc).toBe(DOC);
  });

  it("is a no-op at the end of a list", () => {
    expect(moveRowAt(DOC, rowNamed(DOC, "Buy milk").index, 1).doc).toBe(DOC);
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

  it("on indenting and outdenting", () => {
    for (const doc of cases) {
      for (const row of rowsFor(doc)) {
        for (const delta of [1, -1] as const) {
          expect(indentAt(doc, row.from, delta).doc).toBe(
            throughEditor(doc, row.from, (state) => changeIndent(state, delta)),
          );
        }
      }
    }
  });
});
