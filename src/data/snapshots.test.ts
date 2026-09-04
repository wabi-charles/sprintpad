import { describe, expect, it } from "vitest";
import { describeSnapshot, formatAge, recordSnapshot, type Snapshot } from "./snapshots";

const T0 = 1_700_000_000_000;
const at = (minutes: number) => T0 + minutes * 60_000;
const opts = { limit: 3, minGapMs: 5 * 60_000 };

describe("recordSnapshot", () => {
  it("records the first version", () => {
    expect(recordSnapshot([], "one", T0, opts)).toEqual([{ at: T0, doc: "one" }]);
  });

  it("spaces versions out, so a burst of typing does not fill the buffer", () => {
    const first = recordSnapshot([], "one", T0, opts);
    const tooSoon = recordSnapshot(first, "one edited", at(1), opts);
    expect(tooSoon).toBe(first);
    expect(recordSnapshot(first, "one edited", at(6), opts)).toHaveLength(2);
  });

  it("ignores a document that has not changed", () => {
    const first = recordSnapshot([], "one", T0, opts);
    expect(recordSnapshot(first, "one", at(60), opts)).toBe(first);
  });

  it("never records an empty document, which recovers nothing", () => {
    expect(recordSnapshot([], "", T0, opts)).toEqual([]);
    expect(recordSnapshot([], "   \n\n", T0, opts)).toEqual([]);
  });

  it("drops the oldest past the cap", () => {
    let log: Snapshot[] = [];
    for (let i = 0; i < 5; i++) log = recordSnapshot(log, `v${i}`, at(i * 10), opts);
    expect(log.map((s) => s.doc)).toEqual(["v2", "v3", "v4"]);
  });

  it("does not mutate the list it is given", () => {
    const first = recordSnapshot([], "one", T0, opts);
    recordSnapshot(first, "two", at(10), opts);
    expect(first).toHaveLength(1);
  });
});

describe("describeSnapshot", () => {
  it("names a version by its first task and counts the rest", () => {
    expect(describeSnapshot("# TODAY\nShip the thing\n[x] Done\n  Nested")).toEqual({
      title: "Ship the thing",
      tasks: 3,
    });
  });

  it("ignores headers and blank lines", () => {
    expect(describeSnapshot("# TODAY\n\n# BACKLOG\n")).toEqual({ title: "Empty list", tasks: 0 });
  });
});

describe("formatAge", () => {
  it("reads as prose", () => {
    expect(formatAge(T0, T0 + 5_000)).toBe("just now");
    expect(formatAge(T0, at(1))).toBe("1 minute ago");
    expect(formatAge(T0, at(42))).toBe("42 minutes ago");
    expect(formatAge(T0, at(60))).toBe("1 hour ago");
    expect(formatAge(T0, at(60 * 5))).toBe("5 hours ago");
    expect(formatAge(T0, at(60 * 24))).toBe("1 day ago");
    expect(formatAge(T0, at(60 * 24 * 3))).toBe("3 days ago");
  });

  it("clamps a clock that ran backwards", () => {
    expect(formatAge(T0, T0 - 5000)).toBe("just now");
  });
});
