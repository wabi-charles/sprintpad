import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  changeIndent,
  clearCompleted,
  focusTargetAt,
  nextOpenTaskAfter,
  newTaskLine,
  toggleDone,
  toggleHeader,
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
  it("carries the indentation down, and nothing else", () => {
    expect(apply("one|", newTaskLine)).toBe("one\n");
    expect(apply("  one|", newTaskLine)).toBe("  one\n  ");
  });

  it("puts the cursor after the new indentation", () => {
    const state = stateOf("  one|");
    const next = state.update(newTaskLine(state)!).state;
    expect(next.selection.main.head).toBe(next.doc.length);
  });

  it("splits a task when the cursor is mid-text", () => {
    expect(apply("one| two", newTaskLine)).toBe("one\n two");
    expect(apply("  one| two", newTaskLine)).toBe("  one\n   two");
  });

  it("does not carry a completed marker onto the new line", () => {
    expect(apply("[x] done|", newTaskLine)).toBe("[x] done\n");
  });

  it("does not carry a header marker onto the new line", () => {
    expect(apply("# BACKLOG|", newTaskLine)).toBe("# BACKLOG\n");
  });

  it("clears the indent on an empty indented line, stepping back out", () => {
    expect(apply("one\n  |", newTaskLine)).toBe("one\n");
  });

  it("defers to the editor default on an empty unindented line", () => {
    expect(newTaskLine(stateOf("one\n|"))).toBeNull();
  });

  it("defers to the editor default inside a marker", () => {
    expect(newTaskLine(stateOf("[x]| done"))).toBeNull();
    expect(newTaskLine(stateOf("#| BACKLOG"))).toBeNull();
  });

  it("defers to the editor default when text is selected", () => {
    expect(newTaskLine(stateOf("|one| two"))).toBeNull();
  });
});

describe("toggleDone", () => {
  it("adds and removes the completed marker", () => {
    expect(apply("one|", toggleDone)).toBe("[x] one");
    expect(apply("[x] one|", toggleDone)).toBe("one");
  });

  it("normalizes an explicit open marker away", () => {
    expect(apply("[] one|", toggleDone)).toBe("[x] one");
  });

  it("preserves indentation", () => {
    expect(apply("    one|", toggleDone)).toBe("    [x] one");
    expect(apply("    [x] one|", toggleDone)).toBe("    one");
  });

  it("completes every task in the selection", () => {
    expect(apply("|one\ntwo\nthree|", toggleDone)).toBe("[x] one\n[x] two\n[x] three");
  });

  it("reopens only when the whole selection is already complete", () => {
    expect(apply("|[x] one\ntwo|", toggleDone)).toBe("[x] one\n[x] two");
    expect(apply("|[x] one\n[x] two|", toggleDone)).toBe("one\ntwo");
  });

  it("skips headers and blanks inside a selection", () => {
    expect(apply("|# BACKLOG\none\n\ntwo|", toggleDone)).toBe("# BACKLOG\n[x] one\n\n[x] two");
  });

  it("does nothing when only a header is selected", () => {
    expect(toggleDone(stateOf("# BACKLOG|"))).toBeNull();
  });
});

describe("changeIndent", () => {
  it("indents and outdents the cursor's line", () => {
    expect(apply("one|", (s) => changeIndent(s, 1))).toBe("  one");
    expect(apply("    one|", (s) => changeIndent(s, -1))).toBe("  one");
  });

  it("indents every line in the selection", () => {
    expect(apply("|one\ntwo|", (s) => changeIndent(s, 1))).toBe("  one\n  two");
  });

  it("indents headers and completed tasks too", () => {
    expect(apply("# BACKLOG|", (s) => changeIndent(s, 1))).toBe("  # BACKLOG");
    expect(apply("[x] one|", (s) => changeIndent(s, 1))).toBe("  [x] one");
  });

  it("stops at the left margin instead of no-oping the whole selection", () => {
    expect(apply("|one\n  two|", (s) => changeIndent(s, -1))).toBe("one\ntwo");
  });

  it("does nothing when everything is already at the margin", () => {
    expect(changeIndent(stateOf("one|"), -1)).toBeNull();
  });

  it("normalizes tabs to the canonical unit", () => {
    expect(apply("\tone|", (s) => changeIndent(s, 1))).toBe("    one");
  });
});

describe("focusTargetAt", () => {
  it("returns the task under the cursor", () => {
    const target = focusTargetAt(stateOf("# TODAY\nClaude data se|tup"));
    expect(target).toMatchObject({ text: "Claude data setup" });
  });

  it("returns the task under the cursor when it is complete", () => {
    expect(focusTargetAt(stateOf("[x] don|e"))).toMatchObject({ text: "done", completed: true });
  });

  it("returns null on a header or blank line", () => {
    expect(focusTargetAt(stateOf("# TODAY|\none"))).toBeNull();
    expect(focusTargetAt(stateOf("one\n|"))).toBeNull();
  });

  it("reports the line span so the caller can anchor to it", () => {
    const state = stateOf("one\ntw|o");
    const target = focusTargetAt(state)!;
    expect(state.doc.sliceString(target.from, target.to)).toBe("two");
  });
});

describe("nextOpenTaskAfter", () => {
  it("finds the next incomplete task", () => {
    const state = stateOf("one|\n[x] two\nthree");
    expect(nextOpenTaskAfter(state, 0)?.text).toBe("three");
  });

  it("skips headers", () => {
    const state = stateOf("one|\n# OTHER\ntwo");
    expect(nextOpenTaskAfter(state, 0)?.text).toBe("two");
  });

  it("wraps to the top of the document", () => {
    const state = stateOf("one\n[x] two|");
    expect(nextOpenTaskAfter(state, state.doc.length)?.text).toBe("one");
  });

  it("returns null when nothing is open", () => {
    const state = stateOf("[x] one\n[x] two|");
    expect(nextOpenTaskAfter(state, 0)).toBeNull();
  });
});

describe("toggleHeader", () => {
  it("turns a task into a header and back", () => {
    expect(apply("Backlog|", toggleHeader)).toBe("# Backlog");
    expect(apply("# Backlog|", toggleHeader)).toBe("Backlog");
  });

  it("drops a completed marker on the way to a header", () => {
    expect(apply("[x] Backlog|", toggleHeader)).toBe("# Backlog");
  });

  it("preserves indentation", () => {
    expect(apply("  Backlog|", toggleHeader)).toBe("  # Backlog");
  });

  it("makes the whole selection headers unless they all already are", () => {
    expect(apply("|# One\ntwo|", toggleHeader)).toBe("# One\n# two");
    expect(apply("|# One\n# two|", toggleHeader)).toBe("One\ntwo");
  });

  it("skips blank lines", () => {
    expect(apply("|one\n\ntwo|", toggleHeader)).toBe("# one\n\n# two");
  });

  it("does nothing on a blank line alone", () => {
    expect(toggleHeader(stateOf("|"))).toBeNull();
  });
});

describe("clearCompleted", () => {
  it("removes completed tasks anywhere in the document", () => {
    expect(apply("# TODAY\none\n[x] two\nthree|", clearCompleted)).toBe("# TODAY\none\nthree");
  });

  it("removes several in a row without leaving gaps", () => {
    expect(apply("one\n[x] two\n[x] three\nfour|", clearCompleted)).toBe("one\nfour");
  });

  it("handles a completed task on the first line", () => {
    expect(apply("[x] one\ntwo|", clearCompleted)).toBe("two");
  });

  it("removes a run of completed tasks at the end of the document", () => {
    expect(apply("one\n[x] two\n[x] three|", clearCompleted)).toBe("one");
  });

  it("empties a document that is entirely complete", () => {
    expect(apply("[x] one\n[x] two|", clearCompleted)).toBe("");
  });

  it("leaves headers alone", () => {
    expect(apply("# HIGHRISE\n[x] one|", clearCompleted)).toBe("# HIGHRISE");
  });

  it("does nothing when nothing is complete", () => {
    expect(clearCompleted(stateOf("one|"))).toBeNull();
  });
});
