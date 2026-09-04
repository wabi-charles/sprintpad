import type { PersistedSession, Settings } from "../data/storage";
import type { PanelView } from "./panel";
import {
  beginBreak,
  beginSession,
  expireIfDue,
  fromPersisted,
  isBreakOver,
  keepWorking,
  togglePause,
  totalFocusedSec,
  type FocusSession,
} from "./session";
import { elapsedSec, formatClock, formatDurationLong, remainingSec } from "./timer";

/**
 * The focus session's whole life, with the document and the outside world
 * behind an interface.
 *
 * This is where every session bug in this project has lived -- the orphaned
 * session, the panel naming a task that no longer existed, a session that
 * ended on the first task of a group rather than the last. It sat in the
 * wiring, untestable, and was caught by hand each time. It is testable now.
 */

/** How long a focused task may be absent before the session is orphaned. */
const ORPHAN_GRACE_MS = 2000;
/** How long "you finished it" stays up before the panel returns to idle. */
const FINISHED_MS = 5000;

export interface FocusedTask {
  /** Document position of the task's line. */
  from: number;
  /** Its text as it stands now, which may have been edited since. */
  text: string;
  completed: boolean;
}

export interface LifecycleDeps {
  now(): number;
  settings(): Settings;
  /** Where the session's tasks are in the document at this moment. */
  locate(tasks: readonly string[]): FocusedTask[];
  /** The tasks a session would cover if started right now. */
  candidates(): FocusedTask[];
  anchorTo(positions: readonly number[]): void;
  clearAnchor(): void;
  completeAt(positions: readonly number[]): void;
  persist(session: FocusSession | null): void;
  notify(title: string, body: string): void;
  chime(): void;
  /** Called from a keypress, the only moment a browser will unlock audio. */
  unlockAudio(): void;
}

export function createSessionController(deps: LifecycleDeps) {
  let session: FocusSession | null = null;
  let finished: { task: string; extra: number; focused: string; until: number } | null = null;
  let announcedExpiry: string | null = null;
  let taskMissingSince: number | null = null;

  function save(): void {
    deps.persist(session);
  }

  function start(targets: readonly FocusedTask[]): void {
    if (targets.length === 0) return;
    if (session) end(false);

    const settings = deps.settings();
    session = beginSession({
      tasks: targets.map((target) => target.text),
      anchors: [],
      mode: settings.mode,
      durationSec: settings.mode === "countup" ? 0 : settings.focusSec,
      now: deps.now(),
    });

    finished = null;
    announcedExpiry = null;
    taskMissingSince = null;
    deps.anchorTo(targets.map((target) => target.from));
    save();
    deps.unlockAudio();
  }

  function end(completed: boolean): void {
    if (!session) return;

    if (completed) {
      finished = {
        task: session.tasks[0] ?? "",
        extra: Math.max(0, session.tasks.length - 1),
        focused: formatDurationLong(totalFocusedSec(session, deps.now())),
        until: deps.now() + FINISHED_MS,
      };
    }

    session = null;
    announcedExpiry = null;
    taskMissingSince = null;
    deps.clearAnchor();
    save();
  }

  function change(transition: (current: FocusSession, now: number) => FocusSession): void {
    if (!session) return;
    session = transition(session, deps.now());
    save();
  }

  return {
    get session(): FocusSession | null {
      return session;
    },

    restore(stored: PersistedSession | null): void {
      session = stored === null ? null : fromPersisted(stored);
    },

    start,

    /** Start on whatever the cursor or selection covers. */
    startAtCursor(): void {
      start(deps.candidates());
    },

    stop(): void {
      end(false);
    },

    /** §13: tick the tasks off; the document change is what ends the session. */
    complete(): void {
      if (!session) return;
      const located = deps.locate(session.tasks);
      if (located.length > 0) deps.completeAt(located.map((task) => task.from));
      else end(true);
    },

    /** A session is finished when every task in it is, not the first. */
    noteDocChange(): void {
      if (!session) return;
      const located = deps.locate(session.tasks);
      if (located.length > 0 && located.every((task) => task.completed)) end(true);
    },

    togglePause(): void {
      change(togglePause);
    },

    /** One key for "keep the clock running", whichever phase it is in. */
    toggleClock(): void {
      if (!session) return;
      if (session.phase === "expired") {
        const settings = deps.settings();
        change((current, now) => keepWorking(current, settings.mode, settings.focusSec, now));
      } else {
        change(togglePause);
      }
    },

    takeBreak(): void {
      if (!session || session.phase === "break") return;
      const breakSec = deps.settings().breakSec;
      change((current, now) => beginBreak(current, breakSec, now));
    },

    /** Advances anything the clock alone decides. */
    tick(): void {
      if (!session) return;
      const now = deps.now();

      const advanced = expireIfDue(session, now);
      if (advanced !== session) {
        session = advanced;
        save();
      }

      if (session.phase === "expired" && announcedExpiry !== session.id) {
        announcedExpiry = session.id;
        deps.notify("Focus complete", session.tasks[0] ?? "");
        deps.chime();
      }

      if (isBreakOver(session, now)) {
        deps.notify("Break over", "Ready for the next one.");
        deps.chime();
        end(false);
        return;
      }

      // A session belongs to its tasks. Once they are gone from the document,
      // the panel is naming something that no longer exists.
      if (deps.locate(session.tasks).length > 0) {
        taskMissingSince = null;
      } else {
        taskMissingSince ??= now;
        if (now - taskMissingSince > ORPHAN_GRACE_MS) end(false);
      }
    },

    view(): PanelView {
      const now = deps.now();

      if (!session) {
        if (finished && now < finished.until) {
          return {
            kind: "finished",
            task: finished.task,
            extra: finished.extra,
            focused: finished.focused,
          };
        }
        // Naming the task the cursor is on turns the panel from a description
        // of the shortcut into the control itself.
        const waiting = deps.candidates();
        const first = waiting[0]?.text ?? null;
        const more = waiting.length > 1 ? ` and ${waiting.length - 1} more` : "";
        return { kind: "idle", task: first === null ? null : `${first}${more}` };
      }

      // The live lines win over the titles captured at the start, so renaming
      // a task mid-session shows up straight away.
      const located = deps.locate(session.tasks);
      const titles = located.length > 0 ? located.map((task) => task.text) : [...session.tasks];
      const task = titles[0] ?? "";
      const extra = Math.max(0, titles.length - 1);

      if (session.phase === "expired") {
        return {
          kind: "expired",
          task,
          extra,
          focused: formatDurationLong(totalFocusedSec(session, now)),
        };
      }

      const left = remainingSec(session.timer, now);
      const clock = formatClock(left ?? elapsedSec(session.timer, now));

      if (session.phase === "break") {
        return { kind: "break", task, extra, clock, paused: !session.timer.running };
      }
      return {
        kind: session.phase === "paused" ? "paused" : "running",
        task,
        extra,
        clock,
        countUp: session.timer.mode === "countup",
      };
    },
  };
}

export type SessionController = ReturnType<typeof createSessionController>;
