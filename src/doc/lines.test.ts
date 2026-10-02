import { describe, expect, it } from "vitest";
import { mapPositions, survivingLines } from "./lines";

const DOC = ["# TODAY", "Your first task", "Tap a task to rename it", "", "# BACKLOG", "Later"].join("\n");

/** The offset where a line starts, found by its text. */
const startOf = (doc: string, line: string): number => {
  const at = doc.split("\n").indexOf(line);
  if (at < 0) throw new Error(`no line "${line}"`);
  return doc.split("\n").slice(0, at).reduce((sum, l) => sum + l.length + 1, 0);
};

/** Which line a position sits on, by its text. */
const lineAt = (doc: string, position: number | null): string | null => {
  if (position === null) return null;
  return doc.slice(0, position).split("\n").length - 1 >= 0
    ? doc.split("\n")[doc.slice(0, position).split("\n").length - 1]!
    : null;
};

const follow = (before: string, after: string, line: string): string | null =>
  lineAt(after, mapPositions(before, after, [startOf(before, line)])[0]!);

describe("following a task through an edit", () => {
  it("follows it when a task is added above -- the case that ticked the wrong one", () => {
    const after = DOC.replace("Your first task", "Your first task\nInserted above");
    expect(follow(DOC, after, "Tap a task to rename it")).toBe("Tap a task to rename it");
  });

  it("follows it when a task above is deleted", () => {
    const after = DOC.replace("Your first task\n", "");
    expect(follow(DOC, after, "Tap a task to rename it")).toBe("Tap a task to rename it");
  });

  it("stays with it when it is renamed", () => {
    const after = DOC.replace("Tap a task to rename it", "Renamed while focused");
    expect(follow(DOC, after, "Tap a task to rename it")).toBe("Renamed while focused");
  });

  it("stays with it when it is ticked or indented", () => {
    expect(follow(DOC, DOC.replace("Tap a", "[x] Tap a"), "Tap a task to rename it")).toBe(
      "[x] Tap a task to rename it",
    );
    expect(follow(DOC, DOC.replace("Tap a", "  Tap a"), "Tap a task to rename it")).toBe(
      "  Tap a task to rename it",
    );
  });

  it("follows it when it is dragged somewhere else", () => {
    const after = ["# TODAY", "Your first task", "", "# BACKLOG", "Later", "Tap a task to rename it"].join("\n");
    expect(follow(DOC, after, "Tap a task to rename it")).toBe("Tap a task to rename it");
  });

  it("follows it when a different task is dragged past it", () => {
    const after = ["# TODAY", "Tap a task to rename it", "Your first task", "", "# BACKLOG", "Later"].join("\n");
    expect(follow(DOC, after, "Tap a task to rename it")).toBe("Tap a task to rename it");
  });

  it("gives up rather than guess when it is deleted", () => {
    const after = DOC.replace("Tap a task to rename it\n", "");
    expect(mapPositions(DOC, after, [startOf(DOC, "Tap a task to rename it")])).toEqual([null]);
  });

  it("tells two tasks with the same name apart by where they were", () => {
    const before = ["Call", "Call", "Write"].join("\n");
    const after = ["New", "Call", "Call", "Write"].join("\n");
    // The second "Call" starts at offset 5; it must land on the third line, not the second.
    expect(mapPositions(before, after, [5])).toEqual([startOf(after, "New") + 4 + 5]);
  });

  it("returns positions untouched when nothing changed", () => {
    expect(mapPositions(DOC, DOC, [0, 7, DOC.length])).toEqual([0, 7, DOC.length]);
  });

  it("keeps a position inside its line, not just at its start", () => {
    const at = startOf(DOC, "Tap a task to rename it") + 4;
    const after = DOC.replace("Your first task", "Your first task\nInserted above");
    expect(after.slice(mapPositions(DOC, after, [at])[0]!).startsWith("a task")).toBe(true);
  });
});

describe("the lines that survive", () => {
  it("matches the untouched head and tail without the table", () => {
    const kept = survivingLines(["a", "b", "c", "d"], ["a", "b", "X", "c", "d"]);
    expect([...kept]).toEqual([
      [0, 0],
      [1, 1],
      [2, 3],
      [3, 4],
    ]);
  });

  it("still finds a moved line in the middle", () => {
    const kept = survivingLines(["x", "F", "y", "z"], ["F", "y", "z", "x"]);
    expect(kept.get(1)).toBe(0);
  });

  it("handles empty sides", () => {
    expect(survivingLines([], ["a"]).size).toBe(0);
    expect(survivingLines(["a"], []).size).toBe(0);
  });
});
