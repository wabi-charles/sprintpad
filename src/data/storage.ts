import type { TimerMode, TimerState } from "../focus/timer";
import type { FocusRecord } from "./history";

/**
 * Everything Sprintpad remembers, in localStorage. Reads are defensive: a
 * corrupt value should cost you that one setting, never the app or -- above
 * all -- the document.
 */

export type ThemePreference = "system" | "light" | "dark";
export type SessionPhase = "running" | "paused" | "expired" | "break";

export interface Settings {
  mode: TimerMode;
  focusSec: number;
  breakSec: number;
  theme: ThemePreference;
  notifications: boolean;
}

export interface PersistedSession {
  id: string;
  /** Snapshot of the task text, used if the line is later deleted. */
  taskText: string;
  /** Document position of the task line, mapped through edits. */
  anchor: number | null;
  phase: SessionPhase;
  startedAt: number;
  timer: TimerState;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEYS = {
  doc: "sprintpad.doc",
  settings: "sprintpad.settings",
  history: "sprintpad.history",
  session: "sprintpad.session",
} as const;

export const DEFAULT_SETTINGS: Settings = {
  mode: "countdown",
  focusSec: 50 * 60,
  breakSec: 10 * 60,
  theme: "system",
  notifications: true,
};

const MAX_DURATION_SEC = 8 * 60 * 60;

function isPositiveDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_DURATION_SEC;
}

function isTimerState(value: unknown): value is TimerState {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    (t.mode === "countdown" || t.mode === "countup") &&
    typeof t.durationSec === "number" &&
    typeof t.startedAt === "number" &&
    typeof t.accumulatedSec === "number" &&
    typeof t.running === "boolean"
  );
}

function isFocusRecord(value: unknown): value is FocusRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.taskText === "string" &&
    typeof r.startedAt === "number" &&
    typeof r.seconds === "number" &&
    typeof r.completed === "boolean"
  );
}

export function createStore(backend: StorageLike) {
  function readRaw(key: string): string | null {
    try {
      return backend.getItem(key);
    } catch {
      return null;
    }
  }

  function writeRaw(key: string, value: string): void {
    try {
      backend.setItem(key, value);
    } catch {
      // Private browsing or a full quota. Losing persistence is survivable;
      // taking down the editor is not.
    }
  }

  function readJson<T>(key: string): T | null {
    const raw = readRaw(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  return {
    loadDoc(): string | null {
      return readRaw(KEYS.doc);
    },

    saveDoc(doc: string): void {
      writeRaw(KEYS.doc, doc);
    },

    loadSettings(): Settings {
      const stored = readJson<Partial<Settings>>(KEYS.settings);
      if (!stored || typeof stored !== "object") return { ...DEFAULT_SETTINGS };
      return {
        mode: stored.mode === "countup" ? "countup" : DEFAULT_SETTINGS.mode,
        focusSec: isPositiveDuration(stored.focusSec) ? stored.focusSec : DEFAULT_SETTINGS.focusSec,
        breakSec: isPositiveDuration(stored.breakSec) ? stored.breakSec : DEFAULT_SETTINGS.breakSec,
        theme:
          stored.theme === "light" || stored.theme === "dark" || stored.theme === "system"
            ? stored.theme
            : DEFAULT_SETTINGS.theme,
        notifications:
          typeof stored.notifications === "boolean"
            ? stored.notifications
            : DEFAULT_SETTINGS.notifications,
      };
    },

    saveSettings(settings: Settings): void {
      writeRaw(KEYS.settings, JSON.stringify(settings));
    },

    loadHistory(): FocusRecord[] {
      const stored = readJson<unknown>(KEYS.history);
      if (!Array.isArray(stored)) return [];
      return stored.filter(isFocusRecord);
    },

    saveHistory(log: readonly FocusRecord[]): void {
      writeRaw(KEYS.history, JSON.stringify(log));
    },

    loadSession(): PersistedSession | null {
      const stored = readJson<Record<string, unknown>>(KEYS.session);
      if (!stored || typeof stored !== "object") return null;
      const validPhase =
        stored.phase === "running" ||
        stored.phase === "paused" ||
        stored.phase === "expired" ||
        stored.phase === "break";
      if (
        typeof stored.id !== "string" ||
        typeof stored.taskText !== "string" ||
        typeof stored.startedAt !== "number" ||
        !validPhase ||
        !isTimerState(stored.timer) ||
        !(stored.anchor === null || typeof stored.anchor === "number")
      ) {
        return null;
      }
      return stored as unknown as PersistedSession;
    },

    saveSession(session: PersistedSession | null): void {
      if (session === null) {
        try {
          backend.removeItem(KEYS.session);
        } catch {
          // See writeRaw.
        }
        return;
      }
      writeRaw(KEYS.session, JSON.stringify(session));
    },
  };
}

export type Store = ReturnType<typeof createStore>;

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  flush(): void;
  cancel(): void;
}

/** Trailing-edge debounce with a flush, so we can force a save on unload. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const debounced = ((...args: A) => {
    pending = args;
    if (handle !== null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      const args = pending;
      pending = null;
      if (args) fn(...args);
    }, ms);
  }) as Debounced<A>;

  debounced.flush = () => {
    if (handle !== null) clearTimeout(handle);
    handle = null;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };

  debounced.cancel = () => {
    if (handle !== null) clearTimeout(handle);
    handle = null;
    pending = null;
  };

  return debounced;
}
