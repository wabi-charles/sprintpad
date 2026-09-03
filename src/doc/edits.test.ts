import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  changeIndent,
  clearCompleted,
  convertToTasks,
  focusTargetAt,
  nextOpenTaskAfter,
  newTaskLine,
  toggleDone,
} from "./edits";

/** Builds a state with the cursor at `|`, or a selection between `|` and `|`. */
function stateOf(marked: string): EditorState {
  const first = marked.indexOf("|");
  const second = marked.indexOf("|", first + 1);
  const doc = marked.replace(/\|/g, "");
  const anchor = first;
  const head = second === -1 ? first : second - 1;
  return EditorState.create({ doc, selection: { anchor, head } });
}

function apply(marked: string, fn: (s: EditorState) => any): string {
  const state = stateOf(marked);
  const spec = fn(state);
  if (!spec) throw new Error("expected a transaction");
  return state.update(spec).state.doc.toString();
}

describe("newTaskLine", () => {
  it("continues the list at the same indent", () => {
    expect(apply("[] one|", newTaskLine)).toBe("[] one\n[] ");
    expect(apply("  [] one|", newTaskLine)).toBe("  [] one\n  [] ");
  });

  it("puts the cursor after the new marker", () => {
    const state = stateOf("[] one|");
    const next = state.update(newTaskLine(state)!).state;
    expect(next.selection.main.head).toBe(next.doc.length);
  });

  it("splits a task when the cursor is mid-text", () => {
    expect(apply("[] one| two", newTaskLine)).toBe("[] one\n[] two");
  });

  it("escapes the list on an empty task line", () => {
    expect(apply("[] one\n[] |", newTaskLine)).toBe("[] one\n");
  });

  it("escapes an indented empty task line to the top level", () => {
    expect(apply("[] one\n  [] |", newTaskLine)).toBe("[] one\n");
  });

  it("defers to the editor default on headers and blank lines", () => {
    expect(newTaskLine(stateOf("HIGHRISE|"))).toBeNull();
    expect(newTaskLine(stateOf("|"))).toBeNull();
  });

  it("defers to the editor default when text is selected", () => {
    expect(newTaskLine(stateOf("[] |one| two"))).toBeNull();
  });

  it("carries a completed task forward as an open one", () => {
    expect(apply("[x] done|", newTaskLine)).toBe("[x] done\n[] ");
  });
});

describe("toggleDone", () => {
  it("completes an open task", () => {
    expect(apply("[] one|", toggleDone)).toBe("[x] one");
  });

  it("reopens a completed task", () => {
    expect(apply("[x] one|", toggleDone)).toBe("[] one");
  });

  it("preserves indentation", () => {
    expect(apply("    [] one|", toggleDone)).toBe("    [x] one");
  });

  it("completes every task in the selection", () => {
    expect(apply("|[] one\n[] two\n[] three|", toggleDone)).toBe("[x] one\n[x] two\n[x] three");
  });

  it("reopens only when the whole selection is already complete", () => {
    expect(apply("|[x] one\n[] two|", toggleDone)).toBe("[x] one\n[x] two");
    expect(apply("|[x] one\n[x] two|", toggleDone)).toBe("[] one\n[] two");
  });

  it("skips headers and blanks inside a selection", () => {
    expect(apply("|HIGHRISE\n[] one\n\n[] two|", toggleDone)).toBe("HIGHRISE\n[x] one\n\n[x] two");
  });

  it("does nothing when no task is selected", () => {
    expect(toggleDone(stateOf("HIGHRISE|"))).toBeNull();
  });
});

describe("changeIndent", () => {
  it("indents and outdents the cursor's line", () => {
    expect(apply("[] one|", (s) => changeIndent(s, 1))).toBe("  [] one");
    expect(apply("    [] one|", (s) => changeIndent(s, -1))).toBe("  [] one");
  });

  it("indents every line in the selection", () => {
    expect(apply("|[] one\n[] two|", (s) => changeIndent(s, 1))).toBe("  [] one\n  [] two");
  });

  it("indents headers too", () => {
    expect(apply("HIGHRISE|", (s) => changeIndent(s, 1))).toBe("  HIGHRISE");
  });

  it("stops at the left margin instead of no-oping the whole selection", () => {
    expect(apply("|[] one\n  [] two|", (s) => changeIndent(s, -1))).toBe("[] one\n[] two");
  });

  it("does nothing when everything is already at the margin", () => {
    expect(changeIndent(stateOf("[] one|"), -1)).toBeNull();
  });

  it("normalizes tabs to the canonical unit", () => {
    expect(apply("\t[] one|", (s) => changeIndent(s, 1))).toBe("    [] one");
  });
});

describe("focusTargetAt", () => {
  it("returns the task under the cursor", () => {
    const target = focusTargetAt(stateOf("TODAY\n[] Claude data se|tup"));
    expect(target).toMatchObject({ text: "Claude data setup" });
  });

  it("returns null on a header or blank line", () => {
    expect(focusTargetAt(stateOf("TODAY|\n[] one"))).toBeNull();
    expect(focusTargetAt(stateOf("[] one\n|"))).toBeNull();
  });

  it("returns null for an empty task so a blank marker cannot be focused", () => {
    expect(focusTargetAt(stateOf("[] |"))).toBeNull();
  });

  it("reports the line span so the caller can anchor to it", () => {
    const state = stateOf("[] one\n[] tw|o");
    const target = focusTargetAt(state)!;
    expect(state.doc.sliceString(target.from, target.to)).toBe("[] two");
  });
});

describe("nextOpenTaskAfter", () => {
  it("finds the next incomplete task", () => {
    const state = stateOf("[] one|\n[x] two\n[] three");
    expect(nextOpenTaskAfter(state, 0)?.text).toBe("three");
  });

  it("skips headers", () => {
    const state = stateOf("[] one|\nOTHER\n[] two");
    expect(nextOpenTaskAfter(state, 0)?.text).toBe("two");
  });

  it("wraps to the top of the document", () => {
    const state = stateOf("[] one\n[x] two|");
    expect(nextOpenTaskAfter(state, state.doc.length)?.text).toBe("one");
  });

  it("returns null when nothing is open", () => {
    const state = stateOf("[x] one\n[x] two|");
    expect(nextOpenTaskAfter(state, 0)).toBeNull();
  });
});

describe("convertToTasks", () => {
  it("turns selected bare lines into tasks", () => {
    expect(apply("|Pay taxes\nReview bets|", convertToTasks)).toBe("[] Pay taxes\n[] Review bets");
  });

  it("preserves indentation", () => {
    expect(apply("  Nested note|", convertToTasks)).toBe("  [] Nested note");
  });

  it("leaves existing tasks and blanks alone", () => {
    expect(apply("|[] one\n\nTwo|", convertToTasks)).toBe("[] one\n\n[] Two");
  });

  it("does nothing when there is no header line", () => {
    expect(convertToTasks(stateOf("[] one|"))).toBeNull();
  });
});

describe("clearCompleted", () => {
  it("removes completed tasks anywhere in the document", () => {
    expect(apply("TODAY\n[] one\n[x] two\n[] three|", clearCompleted)).toBe(
      "TODAY\n[] one\n[] three",
    );
  });

  it("removes several in a row without leaving gaps", () => {
    expect(apply("[] one\n[x] two\n[x] three\n[] four|", clearCompleted)).toBe("[] one\n[] four");
  });

  it("handles a completed task on the first line", () => {
    expect(apply("[x] one\n[] two|", clearCompleted)).toBe("[] two");
  });

  it("removes a run of completed tasks at the end of the document", () => {
    expect(apply("[] one\n[x] two\n[x] three|", clearCompleted)).toBe("[] one");
  });

  it("empties a document that is entirely complete", () => {
    expect(apply("[x] one\n[x] two|", clearCompleted)).toBe("");
  });

  it("leaves headers alone", () => {
    expect(apply("HIGHRISE\n[x] one|", clearCompleted)).toBe("HIGHRISE");
  });

  it("does nothing when nothing is complete", () => {
    expect(clearCompleted(stateOf("[] one|"))).toBeNull();
  });
});
