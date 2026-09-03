import { describe, expect, it } from "vitest";
import {
  HEADER_MARKER,
  INDENT_UNIT,
  indentTextFor,
  markerFor,
  migrateLegacyDoc,
  normalizeImportedText,
  parseLine,
} from "./grammar";

describe("parseLine", () => {
  it("treats a bare line as an open task, no markers to type", () => {
    const line = parseLine("Pay taxes");
    expect(line.kind).toBe("task");
    expect(line.completed).toBe(false);
    expect(line.text).toBe("Pay taxes");
    expect(line.indent).toBe(0);
  });

  it("reads a completed task", () => {
    const line = parseLine("[x] Pay taxes");
    expect(line).toMatchObject({ kind: "task", completed: true, text: "Pay taxes" });
    expect(parseLine("[X] Pay taxes").completed).toBe(true);
  });

  it("still accepts explicit open markers, for pasted and imported text", () => {
    expect(parseLine("[] Pay taxes")).toMatchObject({ kind: "task", completed: false, text: "Pay taxes" });
    expect(parseLine("[ ] Pay taxes")).toMatchObject({ kind: "task", completed: false, text: "Pay taxes" });
  });

  it("reads a header", () => {
    expect(parseLine("# Backlog")).toMatchObject({ kind: "header", text: "Backlog" });
    expect(parseLine("#Backlog")).toMatchObject({ kind: "header", text: "Backlog" });
    expect(parseLine("## Backlog")).toMatchObject({ kind: "header", text: "Backlog" });
  });

  it("treats a bare capitalised line as a task, not a header", () => {
    expect(parseLine("BACKLOG").kind).toBe("task");
  });

  it("reports the marker span, which is empty for a bare task", () => {
    expect(parseLine("Pay taxes")).toMatchObject({ markerFrom: 0, markerTo: 0 });

    const done = parseLine("  [x] Pay taxes");
    expect("  [x] Pay taxes".slice(done.markerFrom, done.markerTo)).toBe("[x] ");

    const header = parseLine("# Backlog");
    expect("# Backlog".slice(header.markerFrom, header.markerTo)).toBe("# ");
  });

  it("counts indentation in two-space levels", () => {
    expect(parseLine("a").indent).toBe(0);
    expect(parseLine("  a").indent).toBe(1);
    expect(parseLine("    [x] a").indent).toBe(2);
    expect(parseLine("\ta").indent).toBe(1);
    expect(parseLine("   a").indent).toBe(1);
  });

  it("treats empty and whitespace-only lines as blank", () => {
    expect(parseLine("").kind).toBe("blank");
    expect(parseLine("   ").kind).toBe("blank");
  });

  it("does not mistake a bracketed word for a marker", () => {
    expect(parseLine("[draft] write spec")).toMatchObject({
      kind: "task",
      completed: false,
      text: "[draft] write spec",
    });
  });

  it("does not mistake a mid-line marker for a marker", () => {
    expect(parseLine("see [x] below").text).toBe("see [x] below");
  });
});

describe("markerFor", () => {
  it("writes nothing for an open task, so typing stays free of ceremony", () => {
    expect(markerFor(false)).toBe("");
    expect(markerFor(true)).toBe("[x] ");
  });
});

describe("indentTextFor", () => {
  it("builds canonical indentation and never goes below zero", () => {
    expect(indentTextFor(2)).toBe(INDENT_UNIT.repeat(2));
    expect(indentTextFor(0)).toBe("");
    expect(indentTextFor(-3)).toBe("");
  });
});

describe("round-tripping", () => {
  it("parses back what the primitives compose", () => {
    expect(parseLine(indentTextFor(2) + markerFor(true) + "Ship it")).toMatchObject({
      kind: "task",
      indent: 2,
      completed: true,
      text: "Ship it",
    });
    expect(parseLine(indentTextFor(1) + markerFor(false) + "Ship it")).toMatchObject({
      kind: "task",
      indent: 1,
      completed: false,
      text: "Ship it",
    });
    expect(parseLine(HEADER_MARKER + "Backlog")).toMatchObject({
      kind: "header",
      text: "Backlog",
    });
  });
});

describe("normalizeImportedText", () => {
  it("converts markdown checkboxes to the canonical form", () => {
    expect(normalizeImportedText("- [ ] Pay taxes")).toBe("Pay taxes");
    expect(normalizeImportedText("* [x] Ship it")).toBe("[x] Ship it");
    expect(normalizeImportedText("+ [X] Ship it")).toBe("[x] Ship it");
  });

  it("converts unicode checkboxes", () => {
    expect(normalizeImportedText("☐ Pay taxes")).toBe("Pay taxes");
    expect(normalizeImportedText("☑ Pay taxes")).toBe("[x] Pay taxes");
  });

  it("strips plain markdown bullets", () => {
    expect(normalizeImportedText("- Pay taxes")).toBe("Pay taxes");
  });

  it("preserves indentation, headers and blank lines", () => {
    expect(normalizeImportedText("  - [ ] Nested\n# Backlog\n\nPlain")).toBe(
      "  Nested\n# Backlog\n\nPlain",
    );
  });

  it("normalizes CRLF", () => {
    expect(normalizeImportedText("a\r\nb")).toBe("a\nb");
  });

  it("leaves canonical text untouched", () => {
    const doc = "# TODAY\none\n  [x] two\n\n# BACKLOG\nthree";
    expect(normalizeImportedText(doc)).toBe(doc);
  });
});

describe("migrateLegacyDoc", () => {
  it("keeps bare lines as headers, which is what they used to mean", () => {
    expect(migrateLegacyDoc("TODAY\n[] one\n[x] two\n\nOTHER\n[] three")).toBe(
      "# TODAY\none\n[x] two\n\n# OTHER\nthree",
    );
  });

  it("preserves indentation on both kinds of line", () => {
    expect(migrateLegacyDoc("  Note\n  [] nested")).toBe("  # Note\n  nested");
  });

  it("leaves headers and completed tasks as they are", () => {
    expect(migrateLegacyDoc("# TODAY\n[x] two")).toBe("# TODAY\n[x] two");
  });

  // It cannot be idempotent -- a bare line meant "header" in v1 -- so storage
  // runs it exactly once, guarded by the stored document version.
  it("is not safe to run twice, which is why storage version-guards it", () => {
    // A v1 task loses its marker on the first pass; a second pass would then
    // read that bare line as a v1 header and wrap it.
    expect(migrateLegacyDoc("[] one")).toBe("one");
    expect(migrateLegacyDoc(migrateLegacyDoc("[] one"))).toBe("# one");
  });
});
