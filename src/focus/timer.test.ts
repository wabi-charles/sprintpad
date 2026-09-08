import { describe, expect, it } from "vitest";
import {
  parseSessionLength,
  elapsedSec,
  formatClock,
  formatDurationLong,
  isExpired,
  pauseTimer,
  remainingSec,
  resumeTimer,
  startTimer,
} from "./timer";

const T0 = 1_700_000_000_000;
const sec = (n: number) => T0 + n * 1000;

describe("wall-clock timer", () => {
  it("reports elapsed time from the clock, not from ticks", () => {
    const timer = startTimer("countdown", 3000, T0);
    expect(elapsedSec(timer, sec(0))).toBe(0);
    expect(elapsedSec(timer, sec(90))).toBe(90);
  });

  it("survives a long gap with no ticks at all", () => {
    const timer = startTimer("countdown", 3000, T0);
    expect(elapsedSec(timer, sec(2400))).toBe(2400);
  });

  it("banks elapsed time on pause and stops accruing", () => {
    const paused = pauseTimer(startTimer("countdown", 3000, T0), sec(60));
    expect(paused.running).toBe(false);
    expect(elapsedSec(paused, sec(60))).toBe(60);
    expect(elapsedSec(paused, sec(600))).toBe(60);
  });

  it("resumes from where it paused", () => {
    const paused = pauseTimer(startTimer("countdown", 3000, T0), sec(60));
    const resumed = resumeTimer(paused, sec(600));
    expect(elapsedSec(resumed, sec(630))).toBe(90);
  });

  it("is idempotent on repeated pause and resume", () => {
    const paused = pauseTimer(pauseTimer(startTimer("countdown", 3000, T0), sec(60)), sec(90));
    expect(elapsedSec(paused, sec(120))).toBe(60);
    // The second resume is a no-op, so the clock still runs from sec(120).
    const resumed = resumeTimer(resumeTimer(paused, sec(120)), sec(180));
    expect(elapsedSec(resumed, sec(240))).toBe(180);
  });

  it("counts down and floors at zero", () => {
    const timer = startTimer("countdown", 3000, T0);
    expect(remainingSec(timer, sec(0))).toBe(3000);
    expect(remainingSec(timer, sec(2999))).toBe(1);
    expect(remainingSec(timer, sec(4000))).toBe(0);
  });

  it("expires only once the duration is reached", () => {
    const timer = startTimer("countdown", 3000, T0);
    expect(isExpired(timer, sec(2999))).toBe(false);
    expect(isExpired(timer, sec(3000))).toBe(true);
  });

  it("never expires when counting up", () => {
    const timer = startTimer("countup", 0, T0);
    expect(remainingSec(timer, sec(5000))).toBeNull();
    expect(isExpired(timer, sec(99999))).toBe(false);
    expect(elapsedSec(timer, sec(5000))).toBe(5000);
  });
});

describe("formatClock", () => {
  it("renders mm:ss with padded minutes", () => {
    expect(formatClock(2972)).toBe("49:32");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(59)).toBe("00:59");
    expect(formatClock(300)).toBe("05:00");
  });

  it("adds an hours field past an hour", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(5432)).toBe("1:30:32");
  });

  it("clamps negatives to zero", () => {
    expect(formatClock(-5)).toBe("00:00");
  });
});

describe("duration formatting", () => {
  it("writes prose for the post-session line", () => {
    expect(formatDurationLong(17 * 60)).toBe("17 minutes");
    expect(formatDurationLong(60)).toBe("1 minute");
    expect(formatDurationLong(30)).toBe("less than a minute");
    expect(formatDurationLong(5432)).toBe("1 hour 30 minutes");
    expect(formatDurationLong(3600)).toBe("1 hour");
  });

});

/**
 * Typed by hand, so the failure that matters is a slip being taken seriously:
 * a session length of nothing is worse than the one you already had.
 */
describe("reading a session length", () => {
  it("takes a bare number as minutes, which is how anyone says it", () => {
    expect(parseSessionLength("25")).toBe(25 * 60);
    expect(parseSessionLength("90")).toBe(90 * 60);
  });

  it("takes minutes and seconds", () => {
    expect(parseSessionLength("25:30")).toBe(25 * 60 + 30);
    expect(parseSessionLength("1:30:00")).toBe(90 * 60);
  });

  it("ignores the spaces around it", () => {
    expect(parseSessionLength("  45  ")).toBe(45 * 60);
  });

  it("refuses anything that is not a time", () => {
    for (const junk of ["", "   ", "abc", "25m", "-5", "1:2:3:4", "25.5", "1e3"]) {
      expect(parseSessionLength(junk)).toBeNull();
    }
  });

  it("refuses lengths nobody means", () => {
    expect(parseSessionLength("0")).toBeNull();
    expect(parseSessionLength("0:30")).toBeNull();
    expect(parseSessionLength("481")).toBeNull();
  });

  it("accepts the ends of the range the settings panel allows", () => {
    expect(parseSessionLength("1")).toBe(60);
    expect(parseSessionLength("480")).toBe(480 * 60);
  });
});
