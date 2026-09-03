import { describe, expect, it } from "vitest";
import { appendRecord, todayTotals, type FocusRecord } from "./history";

const day = (iso: string) => new Date(iso).getTime();

function record(partial: Partial<FocusRecord>): FocusRecord {
  return {
    id: "r1",
    taskText: "Claude data setup",
    startedAt: day("2026-09-03T09:00:00"),
    seconds: 600,
    completed: false,
    ...partial,
  };
}

describe("appendRecord", () => {
  it("adds to the end without mutating the input", () => {
    const existing = [record({ id: "a" })];
    const next = appendRecord(existing, record({ id: "b" }));
    expect(next.map((r) => r.id)).toEqual(["a", "b"]);
    expect(existing).toHaveLength(1);
  });

  it("drops the oldest entries past the cap", () => {
    let log: FocusRecord[] = [];
    for (let i = 0; i < 5; i++) log = appendRecord(log, record({ id: `r${i}` }), 3);
    expect(log.map((r) => r.id)).toEqual(["r2", "r3", "r4"]);
  });

  it("ignores sessions too short to be worth logging", () => {
    expect(appendRecord([], record({ seconds: 0 }))).toHaveLength(0);
  });
});

describe("todayTotals", () => {
  const now = day("2026-09-03T18:00:00");

  it("sums repeat sessions on the same task", () => {
    const log = [
      record({ id: "a", taskText: "Claude data setup", seconds: 3120 }),
      record({ id: "b", taskText: "Claude data setup", seconds: 1200 }),
    ];
    expect(todayTotals(log, now)).toEqual({
      rows: [{ taskText: "Claude data setup", seconds: 4320 }],
      totalSeconds: 4320,
    });
  });

  it("ranks the biggest investment first", () => {
    const log = [
      record({ id: "a", taskText: "Review next bets", seconds: 1560 }),
      record({ id: "b", taskText: "White paper", seconds: 5640 }),
      record({ id: "c", taskText: "Claude data setup", seconds: 3120 }),
    ];
    expect(todayTotals(log, now).rows.map((r) => r.taskText)).toEqual([
      "White paper",
      "Claude data setup",
      "Review next bets",
    ]);
    expect(todayTotals(log, now).totalSeconds).toBe(10320);
  });

  it("excludes other days", () => {
    const log = [
      record({ id: "a", startedAt: day("2026-09-02T09:00:00"), seconds: 999 }),
      record({ id: "b", startedAt: day("2026-09-03T09:00:00"), seconds: 600 }),
    ];
    expect(todayTotals(log, now)).toEqual({
      rows: [{ taskText: "Claude data setup", seconds: 600 }],
      totalSeconds: 600,
    });
  });

  it("is empty when nothing was focused today", () => {
    expect(todayTotals([], now)).toEqual({ rows: [], totalSeconds: 0 });
  });
});
