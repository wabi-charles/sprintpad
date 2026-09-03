import { describe, expect, it } from "vitest";
import {
  beginBreak,
  beginSession,
  expireIfDue,
  fromPersisted,
  isBreakOver,
  keepWorking,
  pauseSession,
  resumeSession,
  toRecord,
  togglePause,
  totalFocusedSec,
} from "./session";

const T0 = 1_700_000_000_000;
const sec = (n: number) => T0 + n * 1000;

const start = (durationSec = 3000) =>
  beginSession({ taskText: "Claude data setup", anchor: 12, mode: "countdown", durationSec, now: T0 });

describe("beginSession", () => {
  it("starts running with the timer already going", () => {
    const session = start();
    expect(session.phase).toBe("running");
    expect(session.timer.running).toBe(true);
    expect(session.bankedSec).toBe(0);
    expect(totalFocusedSec(session, sec(60))).toBe(60);
  });
});

describe("pause and resume", () => {
  it("holds the focus total steady while paused", () => {
    const paused = pauseSession(start(), sec(60));
    expect(paused.phase).toBe("paused");
    expect(totalFocusedSec(paused, sec(600))).toBe(60);
  });

  it("resumes accruing", () => {
    const resumed = resumeSession(pauseSession(start(), sec(60)), sec(600));
    expect(totalFocusedSec(resumed, sec(630))).toBe(90);
  });

  it("toggles both ways", () => {
    const paused = togglePause(start(), sec(60));
    expect(paused.phase).toBe("paused");
    expect(togglePause(paused, sec(90)).phase).toBe("running");
  });

  it("will not resume a session that expired", () => {
    const expired = expireIfDue(start(60), sec(60));
    expect(resumeSession(expired, sec(90)).phase).toBe("expired");
  });
});

describe("expiry", () => {
  it("moves to expired once the timer is up and stops the clock", () => {
    const expired = expireIfDue(start(60), sec(75));
    expect(expired.phase).toBe("expired");
    expect(totalFocusedSec(expired, sec(600))).toBe(75);
  });

  it("does nothing before the timer is up", () => {
    expect(expireIfDue(start(60), sec(59)).phase).toBe("running");
  });

  it("leaves a paused session alone", () => {
    const paused = pauseSession(start(60), sec(10));
    expect(expireIfDue(paused, sec(600)).phase).toBe("paused");
  });
});

describe("keep working", () => {
  it("banks the first segment and keeps counting into the second", () => {
    const expired = expireIfDue(start(60), sec(60));
    const again = keepWorking(expired, "countdown", 60, sec(60));
    expect(again.phase).toBe("running");
    expect(again.bankedSec).toBe(60);
    expect(totalFocusedSec(again, sec(90))).toBe(90);
  });

  it("can switch to counting up", () => {
    const expired = expireIfDue(start(60), sec(60));
    const again = keepWorking(expired, "countup", 0, sec(60));
    expect(again.timer.mode).toBe("countup");
    expect(totalFocusedSec(again, sec(660))).toBe(660);
  });
});

describe("breaks", () => {
  it("does not count break time as focus", () => {
    const expired = expireIfDue(start(60), sec(60));
    const resting = beginBreak(expired, 600, sec(60));
    expect(resting.phase).toBe("break");
    expect(totalFocusedSec(resting, sec(400))).toBe(60);
  });

  it("reports when the break is over", () => {
    const resting = beginBreak(expireIfDue(start(60), sec(60)), 600, sec(60));
    expect(isBreakOver(resting, sec(500))).toBe(false);
    expect(isBreakOver(resting, sec(660))).toBe(true);
  });

  it("resumes focus after a break without losing the banked time", () => {
    const resting = beginBreak(expireIfDue(start(60), sec(60)), 600, sec(60));
    const back = keepWorking(resting, "countdown", 3000, sec(660));
    expect(back.bankedSec).toBe(60);
    expect(totalFocusedSec(back, sec(720))).toBe(120);
  });
});

describe("toRecord", () => {
  it("captures the whole session for history", () => {
    const record = toRecord(start(), sec(1020), true);
    expect(record).toMatchObject({
      taskText: "Claude data setup",
      startedAt: T0,
      seconds: 1020,
      completed: true,
    });
  });

  it("excludes break time from the logged total", () => {
    const resting = beginBreak(expireIfDue(start(60), sec(60)), 600, sec(60));
    expect(toRecord(resting, sec(400), false).seconds).toBe(60);
  });
});

describe("fromPersisted", () => {
  it("defaults banked time when it is missing or invalid", () => {
    const session = start();
    const { bankedSec: _drop, ...withoutBanked } = session;
    expect(fromPersisted(withoutBanked).bankedSec).toBe(0);
    expect(fromPersisted({ ...session, bankedSec: -5 }).bankedSec).toBe(0);
  });

  it("keeps a valid banked total", () => {
    expect(fromPersisted({ ...start(), bankedSec: 120 }).bankedSec).toBe(120);
  });
});
