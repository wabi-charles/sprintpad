import { describe, expect, it } from "vitest";
import { transformPastedText } from "./paste";

describe("transformPastedText", () => {
  it("leaves pasted plain lines alone -- they are already tasks", () => {
    const pasted = "Pay taxes\nReview Highrise economy\nBuy golf shaft";
    expect(transformPastedText(pasted)).toBeNull();
  });

  it("leaves a fragment alone so pasting a URL into a task still works", () => {
    expect(transformPastedText("https://example.com")).toBeNull();
  });

  it("leaves sprintpad content untouched so copy/paste round-trips", () => {
    expect(transformPastedText("# TODAY\none\n  [x] two")).toBeNull();
  });

  it("widens a pasted markdown checklist", () => {
    expect(transformPastedText("- [ ] one\n- [x] two")).toBe("one\n[x] two");
  });

  it("widens unicode checkboxes copied out of the rendered list", () => {
    expect(transformPastedText("☐ one\n☑ two")).toBe("one\n[x] two");
  });

  it("preserves indentation and blank lines while widening", () => {
    expect(transformPastedText("- Parent\n  - Child\n\n- Other")).toBe(
      "Parent\n  Child\n\nOther",
    );
  });

  it("normalizes line endings", () => {
    expect(transformPastedText("one\r\ntwo")).toBe("one\ntwo");
  });
});
