import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  backspaceAtLineHead,
  changeIndent,
  clearCompleted,
  focusTargetAt,
  nextOpenTaskAfter,
  newTaskLine,
  toggleDone,
  toggleHeader,
} from "./edits";
import { pendingTaskField, pendingTaskLine, setPendingTask } from "./pendingTask";

/** Builds a state with the cursor at `|`, or a selection between `|` and `|`. */
function stateOf(marked: string): EditorState {
  const first = marked.indexOf("|");
  const second = marked.indexOf("|", first + 1);
  const doc = marked.replace(/\|/g, "");
  const anchor = first;
  const head = second === -1 ? first : second - 1;
  return EditorState.create({ doc, selection: { anchor, head }, extensions: [pendingTaskField] });
}

/** The same, with the cursor's (empty) line marked as a freshly opened task. */
function pendingStateOf(marked: string): EditorState {
  const state = stateOf(marked);
  const next = state.update({
    effects: setPendingTask.of(state.doc.lineAt(state.selection.main.head).from),
  }).state;
  if (pendingTaskLine(next) === null) throw new Error("fixture did not take a pending task");
  return next;
}

function apply(marked: string, fn: (s: EditorState) => any): string {
  const state = stateOf(marked);
  const spec = fn(state);
  if (!spec) throw new Error("expected a transaction");
  return state.update(spec).state.doc.toString();
}

describe("newTaskLine", () => {
  it("opens a new task and marks it as the waiting one", () => {
    const state = stateOf("one|");
    const next = state.update(newTaskLine(state)!).state;
    expect(next.doc.toString()).toBe("one\n");
    expect(pendingTaskLine(next)).toBe(4);
  });

  it("carries the indentation down", () => {
    const state = stateOf("  one|");
    const next = state.update(newTaskLine(state)!).state;
    expect(next.doc.toString()).toBe("  one\n  ");
    expect(next.selection.main.head).toBe(next.doc.length);
    expect(pendingTaskLine(next)).toBe(6);
  });

  it("splits a task when the cursor is mid-text, with nothing left waiting", () => {
    const state = stateOf("one| two");
    const next = state.update(newTaskLine(state)!).state;
    expect(next.doc.toString()).toBe("one\n two");
    expect(pendingTaskLine(next)).toBeNull();
  });

  it("does not carry a completed or header marker onto the new line", () => {
    expect(apply("[x] done|", newTaskLine)).toBe("[x] done\n");
    expect(apply("# BACKLOG|", newTaskLine)).toBe("# BACKLOG\n");
  });

  it("steps out one indent level at a time on the waiting task", () => {
    const state = pendingStateOf("one\n    |");
    const once = state.update(newTaskLine(state)!).state;
    expect(once.doc.toString()).toBe("one\n  ");
    expect(once.selection.main.head).toBe(once.doc.length);
    expect(pendingTaskLine(once)).toBe(4);

    const twice = once.update(newTaskLine(once)!).state;
    expect(twice.doc.toString()).toBe("one\n");
    expect(pendingTaskLine(twice)).toBe(4);
  });

  it("drops the checkbox at the left margin, leaving plain blank space", () => {
    const state = pendingStateOf("one\n|");
    const next = state.update(newTaskLine(state)!).state;
    expect(next.doc.toString()).toBe("one\n");
    expect(next.selection.main.head).toBe(4);
    expect(pendingTaskLine(next)).toBeNull();
  });

  it("defers to the editor default on a blank line that is not waiting", () => {
    expect(newTaskLine(stateOf("one\n|"))).toBeNull();
    expect(newTaskLine(stateOf("one\n  |"))).toBeNull();
  });

  it("defers to the editor default inside a marker", () => {
    expect(newTaskLine(stateOf("[x]| done"))).toBeNull();
    expect(newTaskLine(stateOf("#| BACKLOG"))).toBeNull();
  });

  it("defers to the editor default when text is selected", () => {
    expect(newTaskLine(stateOf("|one| two"))).toBeNull();
  });
});

describe("the waiting task placeholder", () => {
  it("is dropped as soon as the line has text", () => {
    const state = pendingStateOf("one\n|");
    const typed = state.update({ changes: { from: 4, insert: "t" }, selection: { anchor: 5 } }).state;
    expect(pendingTaskLine(typed)).toBeNull();
  });

  it("is dropped when the cursor moves to another line", () => {
    const state = pendingStateOf("one\n|");
    expect(pendingTaskLine(state.update({ selection: { anchor: 0 } }).state)).toBeNull();
  });

  it("is dropped when the line is deleted", () => {
    const state = pendingStateOf("one\n|");
    expect(pendingTaskLine(state.update({ changes: { from: 3, to: 4 } }).state)).toBeNull();
  });

  it("follows edits above it", () => {
    const state = pendingStateOf("one\n|");
    const next = state.update({ changes: { from: 0, insert: "zero\n" } }).state;
    expect(pendingTaskLine(next)).toBe(9);
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

  it("indents a task you just opened, before it has any text", () => {
    expect(apply("one\n|", (s) => changeIndent(s, 1))).toBe("one\n  ");
    expect(apply("one\n  |", (s) => changeIndent(s, -1))).toBe("one\n");
  });

  it("leaves the cursor after the indent, so typing lands inside it", () => {
    const state = stateOf("one\n|");
    const next = state.update(changeIndent(state, 1)!).state;
    expect(next.selection.main.head).toBe(next.doc.length);

    const back = next.update(changeIndent(next, -1)!).state;
    expect(back.selection.main.head).toBe(back.doc.length);
  });

  it("leaves blank spacers alone when indenting a block", () => {
    expect(apply("|one\n\ntwo|", (s) => changeIndent(s, 1))).toBe("  one\n\n  two");
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

describe("backspaceAtLineHead", () => {
  it("removes a completed marker in one press", () => {
    expect(apply("[x] |Pay taxes", backspaceAtLineHead)).toBe("Pay taxes");
  });

  it("removes a header marker in one press", () => {
    expect(apply("# |BACKLOG", backspaceAtLineHead)).toBe("BACKLOG");
    expect(apply("## |BACKLOG", backspaceAtLineHead)).toBe("BACKLOG");
  });

  it("removes an explicit open marker", () => {
    expect(apply("[] |Pay taxes", backspaceAtLineHead)).toBe("Pay taxes");
  });

  it("keeps indentation when removing a marker", () => {
    expect(apply("  [x] |Pay taxes", backspaceAtLineHead)).toBe("  Pay taxes");
    expect(apply("  # |Note", backspaceAtLineHead)).toBe("  Note");
  });

  it("removes the whole marker from inside it", () => {
    expect(apply("[|x] Pay taxes", backspaceAtLineHead)).toBe("Pay taxes");
  });

  it("unwraps from before an invisible marker too, since it looks identical", () => {
    expect(apply("|# BACKLOG", backspaceAtLineHead)).toBe("BACKLOG");
    expect(apply("|[x] Pay taxes", backspaceAtLineHead)).toBe("Pay taxes");
  });

  it("still outdents from before the marker when the line is indented", () => {
    // There the caret is visibly at the indent, not at the head of the text.
    expect(apply("one\n  |[x] Pay taxes", backspaceAtLineHead)).toBe("one\n[x] Pay taxes");
  });

  it("removes a whole indent level, not half of one", () => {
    expect(apply("  |Task", backspaceAtLineHead)).toBe("Task");
    expect(apply("    |Task", backspaceAtLineHead)).toBe("  Task");
  });

  it("leaves the cursor at the head of the text after outdenting", () => {
    const state = stateOf("    |Task");
    const next = state.update(backspaceAtLineHead(state)!).state;
    expect(next.selection.main.head).toBe(2);
  });

  it("outdents an empty line, matching Enter's step-out", () => {
    expect(apply("one\n    |", backspaceAtLineHead)).toBe("one\n  ");
  });

  it("defers to the editor default with nothing to unwrap", () => {
    expect(backspaceAtLineHead(stateOf("|Pay taxes"))).toBeNull();
    expect(backspaceAtLineHead(stateOf("Pay ta|xes"))).toBeNull();
    expect(backspaceAtLineHead(stateOf("one\n|"))).toBeNull();
  });

  it("defers to the editor default when text is selected", () => {
    expect(backspaceAtLineHead(stateOf("[x] |Pay| taxes"))).toBeNull();
  });
});
