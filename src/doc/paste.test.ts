import { describe, expect, it } from "vitest";
import { transformPastedText } from "./paste";

const atStart = { atLineStart: true };
const midLine = { atLineStart: false };

describe("transformPastedText", () => {
  it("turns pasted plain lines into tasks", () => {
    const pasted = "Pay taxes\nReview Highrise economy\nBuy golf shaft";
    expect(transformPastedText(pasted, atStart)).toBe(
      "[] Pay taxes\n[] Review Highrise economy\n[] Buy golf shaft",
    );
  });

  it("leaves a single line alone so pasting a URL into a task still works", () => {
    expect(transformPastedText("https://example.com", atStart)).toBeNull();
  });

  it("leaves sprintpad content untouched so copy/paste round-trips", () => {
    const pasted = "TODAY\n[] one\n  [x] two";
    expect(transformPastedText(pasted, atStart)).toBeNull();
  });

  it("normalizes a pasted markdown checklist instead of double-marking it", () => {
    expect(transformPastedText("- [ ] one\n- [x] two", atStart)).toBe("[] one\n[x] two");
  });

  it("preserves indentation and blank lines", () => {
    expect(transformPastedText("Parent\n  Child\n\nOther", atStart)).toBe(
      "[] Parent\n  [] Child\n\n[] Other",
    );
  });

  it("appends the first line to the current task when pasting mid-line", () => {
    expect(transformPastedText("tail of task\nSecond\nThird", midLine)).toBe(
      "tail of task\n[] Second\n[] Third",
    );
  });

  it("ignores a trailing newline rather than making an empty task", () => {
    expect(transformPastedText("One\nTwo\n", atStart)).toBe("[] One\n[] Two\n");
  });

  it("does not transform when only one line has content", () => {
    expect(transformPastedText("Only one\n\n", atStart)).toBeNull();
  });
});
