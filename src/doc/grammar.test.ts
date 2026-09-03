import { describe, expect, it } from "vitest";
import {
  INDENT_UNIT,
  isTaskLine,
  normalizeImportedText,
  parseLine,
  serializeTask,
  setIndentLevel,
  setCompleted,
} from "./grammar";

describe("parseLine", () => {
  it("reads an open task", () => {
    const line = parseLine("[] Pay taxes");
    expect(line.kind).toBe("task");
    expect(line.completed).toBe(false);
    expect(line.text).toBe("Pay taxes");
    expect(line.indent).toBe(0);
  });

  it("accepts [], [ ], [x] and [X] as markers", () => {
    expect(parseLine("[] a").completed).toBe(false);
    expect(parseLine("[ ] a").completed).toBe(false);
    expect(parseLine("[x] a").completed).toBe(true);
    expect(parseLine("[X] a").completed).toBe(true);
  });

  it("reports the marker span so it can be decorated", () => {
    const line = parseLine("  [x] done thing");
    expect(line.markerFrom).toBe(2);
    expect(line.markerTo).toBe(5);
    expect("  [x] done thing".slice(line.markerFrom, line.markerTo)).toBe("[x]");
  });

  it("counts indentation in two-space levels", () => {
    expect(parseLine("[] a").indent).toBe(0);
    expect(parseLine("  [] a").indent).toBe(1);
    expect(parseLine("    [] a").indent).toBe(2);
    expect(parseLine("\t[] a").indent).toBe(1);
    expect(parseLine("   [] a").indent).toBe(1);
  });

  it("keeps an empty task marker as a task", () => {
    const line = parseLine("[] ");
    expect(line.kind).toBe("task");
    expect(line.text).toBe("");
  });

  it("treats any other non-empty line as a header", () => {
    expect(parseLine("HIGHRISE").kind).toBe("header");
    expect(parseLine("# Highrise").kind).toBe("header");
    expect(parseLine("  Nested note").kind).toBe("header");
    expect(parseLine("HIGHRISE").text).toBe("HIGHRISE");
  });

  it("treats empty and whitespace-only lines as blank", () => {
    expect(parseLine("").kind).toBe("blank");
    expect(parseLine("   ").kind).toBe("blank");
  });

  it("does not mistake a bracket mid-line for a marker", () => {
    expect(parseLine("see [] below").kind).toBe("header");
  });
});

describe("isTaskLine", () => {
  it("is a shorthand for the task kind", () => {
    expect(isTaskLine("[] a")).toBe(true);
    expect(isTaskLine("HEADER")).toBe(false);
  });
});

describe("serializeTask", () => {
  it("builds a task line at a given indent", () => {
    expect(serializeTask(0, false, "Pay taxes")).toBe("[] Pay taxes");
    expect(serializeTask(2, true, "Ship it")).toBe(`${INDENT_UNIT.repeat(2)}[x] Ship it`);
  });

  it("omits the trailing space when the text is empty", () => {
    expect(serializeTask(0, false, "")).toBe("[] ");
  });
});

describe("setCompleted", () => {
  it("flips the marker while preserving indent and text", () => {
    expect(setCompleted("  [] Review bets", true)).toBe("  [x] Review bets");
    expect(setCompleted("  [x] Review bets", false)).toBe("  [] Review bets");
  });

  it("turns a header into a task when completed", () => {
    expect(setCompleted("HIGHRISE", true)).toBe("[x] HIGHRISE");
  });

  it("leaves blank lines alone", () => {
    expect(setCompleted("   ", true)).toBe("   ");
  });
});

describe("setIndentLevel", () => {
  it("re-indents with the canonical unit", () => {
    expect(setIndentLevel("[] a", 2)).toBe("    [] a");
    expect(setIndentLevel("\t\t[] a", 0)).toBe("[] a");
  });

  it("never goes below zero", () => {
    expect(setIndentLevel("[] a", -3)).toBe("[] a");
  });
});

describe("normalizeImportedText", () => {
  it("converts markdown checkboxes", () => {
    expect(normalizeImportedText("- [ ] Pay taxes")).toBe("[] Pay taxes");
    expect(normalizeImportedText("* [x] Ship it")).toBe("[x] Ship it");
    expect(normalizeImportedText("+ [X] Ship it")).toBe("[x] Ship it");
  });

  it("converts unicode checkboxes", () => {
    expect(normalizeImportedText("☐ Pay taxes")).toBe("[] Pay taxes");
    expect(normalizeImportedText("☑ Pay taxes")).toBe("[x] Pay taxes");
  });

  it("preserves indentation and non-task lines", () => {
    expect(normalizeImportedText("  - [ ] Nested\nHIGHRISE\n")).toBe("  [] Nested\nHIGHRISE\n");
  });

  it("normalizes CRLF", () => {
    expect(normalizeImportedText("a\r\nb")).toBe("a\nb");
  });

  it("round-trips text that is already in sprintpad form", () => {
    const doc = "TODAY\n[] one\n  [x] two\n\nOTHER\n[] three";
    expect(normalizeImportedText(doc)).toBe(doc);
  });
});
