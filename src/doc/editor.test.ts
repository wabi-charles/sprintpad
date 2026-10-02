/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { firstOpenTaskEnd } from "./editor";

describe("where the caret starts", () => {
  it("lands at the end of the first open task, not on the header above it", () => {
    const doc = "# TODAY\nYour first task\nAnother";
    expect(doc.slice(0, firstOpenTaskEnd(doc))).toBe("# TODAY\nYour first task");
  });

  it("skips tasks that are already done", () => {
    const doc = "# TODAY\n[x] Done already\nStill open";
    expect(doc.slice(0, firstOpenTaskEnd(doc)).endsWith("Still open")).toBe(true);
  });

  it("skips blank lines", () => {
    const doc = "# TODAY\n\n\nFirst real task";
    expect(doc.slice(0, firstOpenTaskEnd(doc)).endsWith("First real task")).toBe(true);
  });

  it("falls back to the top when there is nothing to start on", () => {
    expect(firstOpenTaskEnd("# TODAY\n[x] All done")).toBe(0);
    expect(firstOpenTaskEnd("")).toBe(0);
  });
});
