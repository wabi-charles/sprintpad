import { recordSnapshot, type Snapshot } from "../data/snapshots";
import { browserStorage, createStore, debounce, type Settings } from "../data/storage";
import { createChime } from "../focus/chime";
import { createSessionController, type FocusedTask } from "../focus/lifecycle";
import { createNotifier } from "../focus/notifications";
import { createPadSync, type SyncStatus } from "../sync/pad";
import { padIdFromPath } from "../sync/padId";

/**
 * Everything Sprintpad is that is not a picture of it.
 *
 * Storage, settings, snapshots, sync, the focus session and the clock live
 * here; a shell draws them. There are two shells -- a keyboard-first editor
 * and a phone -- and the whole point of this seam is that they share one
 * document, one set of storage keys and one implementation of every rule.
 * Anything that behaves differently on a phone is a decision, not an accident.
 */

const TICK_MS = 250;

/*
 * Placeholder, not a tutorial. Every line here is a task, so instructions
 * become task titles -- and a focus session then displays "press ⌘Enter to
 * start focusing" as the thing you are working on.
 */
export const STARTER_DOC = [
  "# TODAY",
  "Your first task",
  "Press ⌘/ to see the shortcuts",
  "",
  "# BACKLOG",
  "Something that can wait",
].join("\n");

/**
 * The document, as the shell that draws it can act on.
 *
 * The desktop implements this over a CodeMirror view and the phone over its
 * own rows; positions are character offsets into the text either way, which
 * is what lets one session controller drive both.
 */
export interface DocSurface {
  getDoc(): string;
  setDoc(doc: string, options?: { keepCursor?: boolean }): void;
  focus(): void;
  /** The focused tasks as they stand now, found by anchor and then by title. */
  locate(tasks: readonly string[]): FocusedTask[];
  /** What a new session would run on, given where the user is. */
  candidates(): FocusedTask[];
  anchorTo(positions: readonly number[]): void;
  clearAnchor(): void;
  completeAt(positions: readonly number[]): void;
  /** Live anchor positions, saved beside the document. */
  anchors(): number[];
  restoreFocus(anchors: readonly number[], tasks: readonly string[]): void;
}

export interface SurfaceHooks {
  /** Call on every change to the text, however it was made. */
  onDocChange(doc: string): void;
  /** The document to open with. */
  initialDoc: string;
}

export function createCore(
  makeSurface: (hooks: SurfaceHooks) => DocSurface,
  options?: { starterDoc?: string },
) {
  /**
   * The URL names the pad. The root is always the local browser list; /happy
   * is the pad "happy", which keeps its own document, history and session.
   */
  const padId = padIdFromPath(window.location.pathname);

  /*
   * Sync used to be a single global toggle with its own key. Pads are
   * addressed by URL now, so that record is orphaned -- and it holds a
   * password, which should not linger.
   */
  try {
    window.localStorage.removeItem("sprintpad.sync");
  } catch {
    // Storage unavailable; nothing to clean up.
  }

  const backend = browserStorage(window.localStorage);
  const store = createStore(backend, padId ?? "");
  let settings: Settings = store.loadSettings();
  let snapshots: Snapshot[] = store.loadSnapshots();

  const notifier = createNotifier(() => settings.notifications);
  const chime = createChime(() => settings.sound);

  const initialDoc = store.loadDoc() ?? options?.starterDoc ?? STARTER_DOC;
  /** The last text written to storage; the candidate for the next snapshot. */
  let savedDoc = initialDoc;

  const tickListeners = new Set<() => void>();
  const statusListeners = new Set<(status: SyncStatus) => void>();

  // The focus anchor moves with every edit, so it is saved alongside the
  // document -- otherwise a reload would resume focus on a stale line.
  const saveState = debounce((doc: string) => {
    // Snapshot what is being replaced, not what replaces it: after a
    // destructive edit, the state worth having back is the one before it.
    const next = recordSnapshot(snapshots, savedDoc, Date.now());
    if (next !== snapshots) {
      snapshots = next;
      store.saveSnapshots(snapshots);
    }
    savedDoc = doc;
    store.saveDoc(doc);
    if (sync.isUnlocked) pushToPad();
  }, 300);

  const surface = makeSurface({
    initialDoc,
    onDocChange: (doc) => {
      saveState(doc);
      sessions.noteDocChange();
    },
  });

  /**
   * Restoring is itself an edit, so it lands in the undo history and the
   * current text becomes a snapshot in its own right -- restoring the wrong
   * version is recoverable too.
   */
  function restoreVersion(doc: string, options?: { keepCursor?: boolean }): void {
    const next = recordSnapshot(snapshots, surface.getDoc(), Date.now(), { minGapMs: 0 });
    if (next !== snapshots) {
      snapshots = next;
      store.saveSnapshots(snapshots);
    }
    surface.setDoc(doc, options);
  }

  const sync = createPadSync({
    padId,
    store,
    getDoc: () => surface.getDoc(),
    // Arriving from another device is an edit like any other: undoable, and
    // the text it replaces becomes a version of its own.
    applyRemote: (doc) => restoreVersion(doc, { keepCursor: true }),
    onStatus: (status) => statusListeners.forEach((listen) => listen(status)),
  });

  const pushToPad = debounce(() => void sync.sync(), 1500);

  const sessions = createSessionController({
    now: () => Date.now(),
    settings: () => settings,
    locate: (tasks) => surface.locate(tasks),
    candidates: () => surface.candidates(),
    anchorTo: (positions) => surface.anchorTo(positions),
    clearAnchor: () => {
      surface.clearAnchor();
      surface.focus();
    },
    completeAt: (positions) => surface.completeAt(positions),
    persist: (session) =>
      store.saveSession(session === null ? null : { ...session, anchors: surface.anchors() }),
    notify: (title, body) => notifier.notify(title, body),
    chime: () => chime.play(),
    unlockAudio: () => {
      void notifier.request();
      chime.prepare();
    },
  });

  function tick(): void {
    sessions.tick();
    const view = sessions.view();
    document.title =
      view.kind === "running" || view.kind === "paused" || view.kind === "break"
        ? `${view.clock} — ${view.task}`
        : "Sprintpad";
    tickListeners.forEach((listen) => listen());
  }

  return {
    padId,
    backend,
    store,
    surface,
    sessions,
    sync,
    notifier,
    chime,
    restoreVersion,

    settings: () => settings,
    snapshots: () => snapshots,

    updateSettings(patch: Partial<Settings>): void {
      settings = { ...settings, ...patch };
      store.saveSettings(settings);
      tick();
    },

    /** Write anything pending to storage now. */
    flush: () => saveState.flush(),

    /** Called every clock tick, after the session has been advanced. */
    onTick(listen: () => void): void {
      tickListeners.add(listen);
    },

    onSyncStatus(listen: (status: SyncStatus) => void): void {
      statusListeners.add(listen);
    },

    /**
     * Start the clock and the network. Shells call this once they have drawn
     * themselves and subscribed, so the first tick has somewhere to land.
     */
    start(): void {
      const stored = store.loadSession();
      sessions.restore(stored);
      if (stored) surface.restoreFocus(stored.anchors, stored.tasks);

      window.addEventListener("beforeunload", () => saveState.flush());

      // A paused tab stops ticking; catching up on return is what keeps the
      // wall-clock timer honest.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        tick();
        if (sync.isUnlocked) void sync.sync();
      });

      /*
       * Another device's edit has to be fetched -- the server pushes nothing
       * -- so a pad left open on a desk would otherwise show yesterday's list
       * until it was reloaded. Only while the tab is visible: a hidden one
       * catches up the moment it comes back, which the handler above does.
       *
       * A poll can only ever pull when this device has not touched the
       * document since its last sync; the moment it has, reconcile calls it a
       * push or a conflict. So this cannot overwrite anything typed here.
       */
      setInterval(() => {
        if (document.hidden || !sync.isUnlocked) return;
        void sync.sync({ quiet: true });
      }, 20_000);

      // A device just back online is the one most likely to be behind.
      window.addEventListener("online", () => {
        if (sync.isUnlocked) void sync.sync();
      });

      setInterval(tick, TICK_MS);
      tick();

      // The badge starts with whatever state the session opened in; onStatus
      // only speaks up when that changes.
      statusListeners.forEach((listen) => listen(sync.status));

      // Pick up anything another device wrote while this one was closed.
      if (sync.isUnlocked) void sync.sync();
    },
  };
}

export type AppCore = ReturnType<typeof createCore>;
