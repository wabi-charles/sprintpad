/**
 * The timer is wall-clock arithmetic, not accumulated ticks: everything is
 * derived from `Date.now()` against a start stamp. That is what lets a session
 * survive a throttled background tab or a full page reload intact.
 */

export type TimerMode = "countdown" | "countup";

export interface TimerState {
  mode: TimerMode;
  /** Target length in seconds; ignored when counting up. */
  durationSec: number;
  /** Epoch ms when the current running segment began. */
  startedAt: number;
  /** Seconds banked from previous running segments. */
  accumulatedSec: number;
  running: boolean;
}

export function startTimer(mode: TimerMode, durationSec: number, now: number): TimerState {
  return { mode, durationSec, startedAt: now, accumulatedSec: 0, running: true };
}

export function elapsedSec(timer: TimerState, now: number): number {
  const live = timer.running ? Math.max(0, (now - timer.startedAt) / 1000) : 0;
  return Math.floor(timer.accumulatedSec + live);
}

export function pauseTimer(timer: TimerState, now: number): TimerState {
  if (!timer.running) return timer;
  return { ...timer, running: false, accumulatedSec: elapsedSec(timer, now) };
}

export function resumeTimer(timer: TimerState, now: number): TimerState {
  if (timer.running) return timer;
  return { ...timer, running: true, startedAt: now };
}

/** Seconds left, or null when counting up (there is no end). */
export function remainingSec(timer: TimerState, now: number): number | null {
  if (timer.mode === "countup") return null;
  return Math.max(0, timer.durationSec - elapsedSec(timer, now));
}

export function isExpired(timer: TimerState, now: number): boolean {
  return timer.mode === "countdown" && elapsedSec(timer, now) >= timer.durationSec;
}

/** `MM:SS`, growing an hours field only when it is needed. */
export function formatClock(totalSec: number): string {
  const total = Math.max(0, Math.floor(totalSec));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours === 0) return `${String(minutes).padStart(2, "0")}:${seconds}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Prose, for the line shown when a task is finished (§13). */
export function formatDurationLong(totalSec: number): string {
  const minutes = Math.floor(Math.max(0, totalSec) / 60);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
}

/** Compact, for the history table (§17). */
export function formatDurationShort(totalSec: number): string {
  const minutes = Math.floor(Math.max(0, totalSec) / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
