/**
 * The cases that decide whether two devices can share a list without a person
 * arbitrating every time they are both used in one afternoon.
 */
import { describe, expect, it } from "vitest";
import { mergeDocs } from "./merge";

const BASE = ["# TODAY", "Ship the thing", "Call the bank", "", "# BACKLOG", "Read the paper"].join(
  "\n",
);

function clean(base: string, mine: string, theirs: string): string {
  const result = mergeDocs(base, mine, theirs);
  if (result.kind !== "clean") throw new Error("expected a clean merge");
  return result.doc;
}

describe("edits that do not overlap", () => {
  it("keeps a tick from one device and an addition from the other", () => {
    const mine = BASE.replace("Call the bank", "[x] Call the bank");
    const theirs = BASE.replace("Read the paper", "Read the paper\nBook the flight");

    const merged = clean(BASE, mine, theirs);
    expect(merged).toContain("[x] Call the bank");
    expect(merged).toContain("Book the flight");
    expect(merged).toContain("Ship the thing");
  });

  it("is the same list whichever device is called mine", () => {
    const mine = BASE.replace("Call the bank", "[x] Call the bank");
    const theirs = BASE.replace("Read the paper", "Read the paper\nBook the flight");

    expect(clean(BASE, mine, theirs).split("\n").sort()).toEqual(
      clean(BASE, theirs, mine).split("\n").sort(),
    );
  });

  it("keeps a deletion made on one device", () => {
    const mine = BASE.split("\n").filter((l) => l !== "Call the bank").join("\n");
    const theirs = BASE.replace("Ship the thing", "[x] Ship the thing");

    const merged = clean(BASE, mine, theirs);
    expect(merged).not.toContain("Call the bank");
    expect(merged).toContain("[x] Ship the thing");
  });

  it("keeps both when each device appends a task", () => {
    const mine = `${BASE}\nFrom the desk`;
    const theirs = `${BASE}\nFrom the phone`;

    const merged = clean(BASE, mine, theirs);
    expect(merged).toContain("From the desk");
    expect(merged).toContain("From the phone");
  });

  it("keeps both when each device inserts into the same gap", () => {
    const mine = BASE.replace("# BACKLOG", "Squeezed in here\n# BACKLOG");
    const theirs = BASE.replace("# BACKLOG", "And this too\n# BACKLOG");

    const merged = clean(BASE, mine, theirs);
    expect(merged).toContain("Squeezed in here");
    expect(merged).toContain("And this too");
  });

  it("preserves order, which is the priority in this product", () => {
    const mine = BASE.replace("Ship the thing", "[x] Ship the thing");
    const merged = clean(BASE, mine, BASE);
    expect(merged.split("\n").indexOf("[x] Ship the thing")).toBeLessThan(
      merged.split("\n").indexOf("Call the bank"),
    );
  });
});

describe("edits that agree", () => {
  it("takes one copy when both devices made the same change", () => {
    const both = BASE.replace("Call the bank", "[x] Call the bank");
    expect(clean(BASE, both, both)).toBe(both);
  });

  it("returns the document untouched when neither device changed anything", () => {
    expect(clean(BASE, BASE, BASE)).toBe(BASE);
  });

  it("takes the other side when this device changed nothing", () => {
    const theirs = BASE.replace("Read the paper", "[x] Read the paper");
    expect(clean(BASE, BASE, theirs)).toBe(theirs);
  });
});

describe("edits that genuinely collide", () => {
  it("refuses when both devices rewrote the same line differently", () => {
    const mine = BASE.replace("Call the bank", "Call the bank about the mortgage");
    const theirs = BASE.replace("Call the bank", "Call the bank before noon");
    expect(mergeDocs(BASE, mine, theirs)).toEqual({ kind: "conflict" });
  });

  it("refuses when one device edited a line the other deleted", () => {
    const mine = BASE.replace("Call the bank", "[x] Call the bank");
    const theirs = BASE.split("\n").filter((l) => l !== "Call the bank").join("\n");
    expect(mergeDocs(BASE, mine, theirs)).toEqual({ kind: "conflict" });
  });
});

describe("the awkward shapes", () => {
  it("merges into an empty ancestor", () => {
    const merged = clean("", "one", "");
    expect(merged).toBe("one");
  });

  it("handles a document emptied on one device", () => {
    const theirs = BASE.replace("Read the paper", "[x] Read the paper");
    expect(mergeDocs(BASE, "", theirs)).toEqual({ kind: "conflict" });
  });

  it("does not trip over repeated identical lines", () => {
    const base = "a\nb\na\nb";
    const mine = "a\nb\na\nb\nc";
    const theirs = "a\nb\na\nb\nd";
    const merged = clean(base, mine, theirs);
    expect(merged).toContain("c");
    expect(merged).toContain("d");
    expect(merged.startsWith("a\nb\na\nb")).toBe(true);
  });
});
