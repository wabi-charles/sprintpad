import type { PersistedSession, SessionPhase } from "../data/storage";
import {
  elapsedSec,
  isExpired,
  pauseTimer,
  resumeTimer,
  startTimer,
  type TimerMode,
} from "./timer";

/**
 * The focus session state machine (§10-§13). A session is one task plus a
 * chain of segments: focus, maybe a break, maybe more focus. `bankedSec`
 * carries focus time across segments so "Keep Working" extends the session
 * rather than starting the accounting over.
 *
 * Break time is deliberately never banked -- it is rest, not focus.
 */

export type FocusSession = PersistedSession & { bankedSec: number };

export interface BeginOptions {
  tasks: string[];
  anchors: number[];
  mode: TimerMode;
  durationSec: number;
  now: number;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s_${Math.random().toString(36).slice(2)}`;

const FOCUS_PHASES: readonly SessionPhase[] = ["running", "paused", "expired"];

export function isFocusPhase(phase: SessionPhase): boolean {
  return FOCUS_PHASES.includes(phase);
}

export function beginSession({
  tasks,
  anchors,
  mode,
  durationSec,
  now,
}: BeginOptions): FocusSession {
  return {
    id: newId(),
    tasks,
    anchors,
    phase: "running",
    startedAt: now,
    bankedSec: 0,
    timer: startTimer(mode, durationSec, now),
  };
}

export function pauseSession(session: FocusSession, now: number): FocusSession {
  if (session.phase !== "running" && session.phase !== "break") return session;
  return { ...session, phase: "paused", timer: pauseTimer(session.timer, now) };
}

export function resumeSession(session: FocusSession, now: number): FocusSession {
  if (session.phase !== "paused") return session;
  return { ...session, phase: "running", timer: resumeTimer(session.timer, now) };
}

export function togglePause(session: FocusSession, now: number): FocusSession {
  return session.phase === "paused" ? resumeSession(session, now) : pauseSession(session, now);
}

/** Moves a running focus segment to `expired` once its timer is up (§12). */
export function expireIfDue(session: FocusSession, now: number): FocusSession {
  if (session.phase !== "running" || !isExpired(session.timer, now)) return session;
  return { ...session, phase: "expired", timer: pauseTimer(session.timer, now) };
}

/** A break that has run its course; the caller returns to the idle state. */
export function isBreakOver(session: FocusSession, now: number): boolean {
  return session.phase === "break" && isExpired(session.timer, now);
}

/** §12 "Keep Working": bank what was focused so far and start a fresh segment. */
export function keepWorking(
  session: FocusSession,
  mode: TimerMode,
  durationSec: number,
  now: number,
): FocusSession {
  return {
    ...session,
    phase: "running",
    bankedSec: totalFocusedSec(session, now),
    timer: startTimer(mode, durationSec, now),
  };
}

/** §12 "Take Break": bank the focus time, then run a timer that does not count. */
export function beginBreak(
  session: FocusSession,
  breakSec: number,
  now: number,
): FocusSession {
  return {
    ...session,
    phase: "break",
    bankedSec: totalFocusedSec(session, now),
    timer: startTimer("countdown", breakSec, now),
  };
}

/** Focus seconds across the whole session, excluding any break. */
export function totalFocusedSec(session: FocusSession, now: number): number {
  const live = isFocusPhase(session.phase) ? elapsedSec(session.timer, now) : 0;
  return session.bankedSec + live;
}

/** Restores a persisted session, tolerating an older shape without bankedSec. */
export function fromPersisted(stored: PersistedSession & { bankedSec?: number }): FocusSession {
  const banked = stored.bankedSec;
  return { ...stored, bankedSec: typeof banked === "number" && banked >= 0 ? banked : 0 };
}
