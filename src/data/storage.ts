import { migrateLegacyDoc } from "../doc/grammar";
import type { TimerMode, TimerState } from "../focus/timer";
import type { SyncedState } from "../sync/reconcile";
import type { Snapshot } from "./snapshots";

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
  sound: boolean;
}

export interface PersistedSession {
  id: string;
  /** Titles captured at session start, used if the lines are later deleted. */
  tasks: string[];
  /** Document positions of those task lines, mapped through edits. */
  anchors: number[];
  phase: SessionPhase;
  startedAt: number;
  timer: TimerState;
}

/**
 * Only present once sync is switched on; absent means the pad is local to this
 * browser, which is the default and the normal case.
 */
export interface SyncConfig {
  padKey: string;
  /** Per-pad salt for the key derivation; useless without the password. */
  salt: string;
  /**
   * Kept here so the pad opens without retyping. The plaintext document is
   * already in this same storage, so holding the password beside it does not
   * widen what someone with the device can read.
   */
  password: string;
  lastSynced: SyncedState | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Bumped when the meaning of the document text changes, so a stored document
 * is reinterpreted deliberately rather than silently.
 */
export const DOC_VERSION = 2;

export const KEYS = {
  doc: "sprintpad.doc",
  docVersion: "sprintpad.docVersion",
  settings: "sprintpad.settings",
  session: "sprintpad.session",
  snapshots: "sprintpad.snapshots",
  sync: "sprintpad.sync",
} as const;

export const DEFAULT_SETTINGS: Settings = {
  mode: "countdown",
  focusSec: 50 * 60,
  breakSec: 10 * 60,
  theme: "system",
  notifications: true,
  sound: true,
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
    /** Migrates a v1 document on the way out, exactly once. */
    loadDoc(): string | null {
      const doc = readRaw(KEYS.doc);
      if (doc === null) return null;

      const stored = Number(readRaw(KEYS.docVersion) ?? "1");
      const version = Number.isFinite(stored) ? stored : 1;
      if (version >= DOC_VERSION) return doc;

      const migrated = migrateLegacyDoc(doc);
      writeRaw(KEYS.doc, migrated);
      writeRaw(KEYS.docVersion, String(DOC_VERSION));
      return migrated;
    },

    saveDoc(doc: string): void {
      writeRaw(KEYS.doc, doc);
      writeRaw(KEYS.docVersion, String(DOC_VERSION));
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
        sound: typeof stored.sound === "boolean" ? stored.sound : DEFAULT_SETTINGS.sound,
      };
    },

    saveSettings(settings: Settings): void {
      writeRaw(KEYS.settings, JSON.stringify(settings));
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
        typeof stored.startedAt !== "number" ||
        !validPhase ||
        !isTimerState(stored.timer)
      ) {
        return null;
      }

      // Sessions used to hold a single taskText/anchor; carry those forward.
      const tasks = Array.isArray(stored.tasks)
        ? stored.tasks.filter((task): task is string => typeof task === "string")
        : typeof stored.taskText === "string"
          ? [stored.taskText]
          : [];
      if (tasks.length === 0) return null;

      const anchors = Array.isArray(stored.anchors)
        ? stored.anchors.filter((a): a is number => typeof a === "number")
        : typeof stored.anchor === "number"
          ? [stored.anchor]
          : [];

      return { ...stored, tasks, anchors } as unknown as PersistedSession;
    },

    loadSnapshots(): Snapshot[] {
      const stored = readJson<unknown>(KEYS.snapshots);
      if (!Array.isArray(stored)) return [];
      return stored.filter(
        (entry): entry is Snapshot =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Snapshot).at === "number" &&
          typeof (entry as Snapshot).doc === "string",
      );
    },

    saveSnapshots(list: readonly Snapshot[]): void {
      writeRaw(KEYS.snapshots, JSON.stringify(list));
    },

    loadSync(): SyncConfig | null {
      const stored = readJson<Partial<SyncConfig>>(KEYS.sync);
      if (!stored || typeof stored !== "object") return null;
      if (
        typeof stored.padKey !== "string" ||
        typeof stored.salt !== "string" ||
        typeof stored.password !== "string"
      ) {
        return null;
      }

      const synced = stored.lastSynced;
      const lastSynced =
        synced && typeof synced.doc === "string" && typeof synced.updatedAt === "number"
          ? { doc: synced.doc, updatedAt: synced.updatedAt }
          : null;

      return {
        padKey: stored.padKey,
        salt: stored.salt,
        password: stored.password,
        lastSynced,
      };
    },

    saveSync(config: SyncConfig | null): void {
      if (config === null) {
        try {
          backend.removeItem(KEYS.sync);
        } catch {
          // See writeRaw.
        }
        return;
      }
      writeRaw(KEYS.sync, JSON.stringify(config));
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
