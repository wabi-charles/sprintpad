import { describe, expect, it } from "vitest";
import { openCount, rowAt, rowsFor, sectionsFor } from "./rows";

const DOC = [
  "# TODAY",
  "Ship it",
  "  A subtask",
  "[x] Call the bank",
  "",
  "# BACKLOG",
  "Read the paper",
].join("\n");

describe("rows", () => {
  it("gives every line an offset that indexes back into the document", () => {
    const rows = rowsFor(DOC);
    for (const row of rows) {
      expect(DOC.slice(row.from, row.to)).toBe(row.raw);
    }
  });

  it("reads kind, depth and completion from the grammar", () => {
    const rows = rowsFor(DOC);
    expect(rows[0]).toMatchObject({ kind: "header", text: "TODAY" });
    expect(rows[1]).toMatchObject({ kind: "task", text: "Ship it", done: false, depth: 0 });
    expect(rows[2]).toMatchObject({ kind: "task", text: "A subtask", depth: 1 });
    expect(rows[3]).toMatchObject({ kind: "task", text: "Call the bank", done: true });
    expect(rows[4]).toMatchObject({ kind: "blank" });
  });

  it("handles an empty document as one blank row", () => {
    expect(rowsFor("")).toHaveLength(1);
    expect(rowsFor("")[0]).toMatchObject({ kind: "blank", from: 0, to: 0 });
  });

  it("finds the row holding a position, which is how focus follows a task", () => {
    const rows = rowsFor(DOC);
    const target = rows[1]!;
    expect(rowAt(rows, target.from)?.text).toBe("Ship it");
    expect(rowAt(rows, target.to)?.text).toBe("Ship it");
    expect(rowAt(rows, 9999)).toBeNull();
  });
});

describe("sections", () => {
  it("groups rows under the header above them", () => {
    const sections = sectionsFor(rowsFor(DOC));
    expect(sections).toHaveLength(2);
    expect(sections[0]!.header?.text).toBe("TODAY");
    expect(sections[0]!.rows.map((r) => r.text)).toEqual([
      "Ship it",
      "A subtask",
      "Call the bank",
    ]);
    expect(sections[1]!.header?.text).toBe("BACKLOG");
  });

  it("treats tasks written before any header as one unnamed section", () => {
    const sections = sectionsFor(rowsFor("loose one\nloose two\n# LATER\nthird"));
    expect(sections[0]!.header).toBeNull();
    expect(sections[0]!.rows).toHaveLength(2);
    expect(sections[1]!.header?.text).toBe("LATER");
  });

  it("does not invent a section for a document that starts with a header", () => {
    expect(sectionsFor(rowsFor("# ONLY\na task"))).toHaveLength(1);
  });

  it("counts what is left, not what is there", () => {
    const [today] = sectionsFor(rowsFor(DOC));
    expect(openCount(today!)).toBe(2);
  });

  it("has nothing to show for an empty document", () => {
    expect(sectionsFor(rowsFor(""))).toEqual([]);
  });

  it("hides blank lines, which are spacing rather than tasks", () => {
    const [today] = sectionsFor(rowsFor(DOC));
    expect(today!.rows.some((row) => row.kind === "blank")).toBe(false);
  });

  it("shows the one blank line being typed into", () => {
    // A task that has just been created is an empty line until it is named.
    const doc = "# TODAY\nShip it\n";
    const rows = rowsFor(doc);
    const fresh = rows[rows.length - 1]!;
    expect(fresh.kind).toBe("blank");

    const without = sectionsFor(rows)[0]!;
    expect(without.rows.map((r) => r.text)).toEqual(["Ship it"]);

    const withIt = sectionsFor(rows, fresh.from)[0]!;
    expect(withIt.rows).toHaveLength(2);
    expect(withIt.rows[1]!.from).toBe(fresh.from);
  });
});
