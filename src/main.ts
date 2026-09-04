import type { EditorState, TransactionSpec } from "@codemirror/state";
import { createEditor } from "./doc/editor";
import { clearCompleted, focusTargetsIn, toggleHeader, type TaskTarget } from "./doc/edits";
import { focusAnchorsField, resolveFocusedLines } from "./doc/focusField";
import { parseLine } from "./doc/grammar";
import { recordSnapshot, type Snapshot } from "./data/snapshots";
import { browserStorage, createStore, debounce, type Settings } from "./data/storage";
import { createChime } from "./focus/chime";
import { createNotifier } from "./focus/notifications";
import { createFocusPanel, type PanelView } from "./focus/panel";
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
} from "./focus/session";
import { elapsedSec, formatClock, formatDurationLong, remainingSec } from "./focus/timer";
import { createPalette, type PaletteCommand } from "./ui/palette";
import { createSettingsView } from "./ui/settingsView";
import { createPadSync, type SyncStatus } from "./sync/pad";
import { padIdFromPath } from "./sync/padId";
import { createShortcutsView } from "./ui/shortcutsView";
import { createSnapshotsView } from "./ui/snapshotsView";
import { createPadsView } from "./ui/padsView";
import { createUnlockView } from "./ui/unlockView";
import { createTheme } from "./ui/theme";
import "./styles.css";

/**
 * Wiring only. Everything with logic in it lives in the modules above; this
 * file decides what happens when, and owns the single render loop.
 */

/*
 * Placeholder, not a tutorial. Every line here is a task, so instructions
 * become task titles -- and a focus session then displays "press ⌘Enter to
 * start focusing" as the thing you are working on. The idle panel teaches
 * ⌘Enter, and ⌘/ teaches the rest.
 */
const STARTER_DOC = [
  "# TODAY",
  "Your first task",
  "Press ⌘/ to see the shortcuts",
  "",
  "# BACKLOG",
  "Something that can wait",
].join("\n");

const TICK_MS = 250;
/**
 * How long the focused task may be absent from the document before the session
 * is treated as orphaned. Long enough to survive a cut and paste, short enough
 * that the panel never sits there naming a task that no longer exists.
 */
const ORPHAN_GRACE_MS = 2000;
/** How long the "you finished it" line stays up before returning to idle. */
const FINISHED_MS = 5000;

/**
 * The URL names the pad. The root is always the local browser list; /happy is
 * the pad "happy", which keeps its own document, history and session.
 */
const activePadId = padIdFromPath(window.location.pathname);

/*
 * Sync used to be a single global toggle with its own key. Pads are addressed
 * by URL now, so that record is orphaned -- and it holds a password, which
 * should not linger.
 */
try {
  window.localStorage.removeItem("sprintpad.sync");
} catch {
  // Storage unavailable; nothing to clean up.
}
const backend = browserStorage(window.localStorage);
const store = createStore(backend, activePadId ?? "");
let settings: Settings = store.loadSettings();
let session: FocusSession | null = null;
let snapshots: Snapshot[] = store.loadSnapshots();
let finished: { task: string; extra: number; focused: string; until: number } | null = null;
let announcedExpiry: string | null = null;
let taskMissingSince: number | null = null;

const app = document.getElementById("app")!;

const header = document.createElement("header");
header.className = "sp-bar";
const brand = document.createElement("span");
brand.className = "sp-bar__brand";
brand.textContent = "SPRINTPAD";

/*
 * Which pad you are in. A pad and the local list look identical otherwise, so
 * without this the only clue is the address bar. Absent at the root, where
 * there is nothing to say: that is the default.
 */
const padBadge = document.createElement("button");
padBadge.type = "button";
padBadge.className = "sp-bar__pad";
padBadge.hidden = activePadId === null;
if (activePadId !== null) {
  const name = document.createElement("span");
  name.className = "sp-bar__padname";
  name.textContent = activePadId;
  const dot = document.createElement("span");
  dot.className = "sp-bar__dot";
  padBadge.append(name, dot);
  padBadge.addEventListener("click", () => padsPanel.open(() => editor.focus()));
}
const barActions = document.createElement("div");
barActions.className = "sp-bar__actions";
header.append(brand, padBadge, barActions);

const focusHost = document.createElement("div");
const workpad = document.createElement("main");
workpad.className = "sp-workpad";
app.append(header, focusHost, workpad);

const initialDoc = store.loadDoc() ?? STARTER_DOC;
/** The last text written to storage; the candidate for the next snapshot. */
let savedDoc = initialDoc;

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
  persistSession();
  if (padSync.isUnlocked) pushToPad();
}, 300);
const notifier = createNotifier(() => settings.notifications);
const chime = createChime(() => settings.sound);

const editor = createEditor({
  parent: workpad,
  doc: initialDoc,
  onDocChange: handleDocChange,
  onStartFocus: startFocus,
  onCommandPalette: openPalette,
  focusSnapshot: () => session?.tasks ?? null,
});

const theme = createTheme(settings.theme, (dark) => editor.setDark(dark));

const panel = createFocusPanel(focusHost, {
  start: () => startFocus(focusTargetsIn(editor.view.state)),
  togglePause: () => mutate((current, now) => togglePause(current, now)),
  done: completeFocusedTask,
  stop: () => endSession(false),
  keepWorking: () =>
    mutate((current, now) => keepWorking(current, settings.mode, settings.focusSec, now)),
  takeBreak: () => mutate((current, now) => beginBreak(current, settings.breakSec, now)),
  endBreak: () => endSession(false),
});

const timerSettings = createSettingsView(app, () => settings, updateSettings);
const shortcuts = createShortcutsView(app);
const versions = createSnapshotsView(app, () => snapshots, restoreVersion);

/**
 * Off unless switched on. While it is off nothing here runs and the pad never
 * leaves the browser, which stays the ordinary way to use Sprintpad.
 */
const padSync = createPadSync({
  padId: activePadId,
  store,
  getDoc: () => editor.getDoc(),
  // Arriving from another device is an edit like any other: undoable, and the
  // text it replaces becomes a version of its own.
  applyRemote: (doc) => restoreVersion(doc),
  onStatus: (status) => {
    unlockPanel.refresh();
    padsPanel.refresh();
    showPadStatus(status);
  },
});
const unlockPanel = createUnlockView(app, padSync, () => saveState.flush());
function showPadStatus(status: SyncStatus): void {
  if (activePadId === null) return;
  padBadge.dataset.state = status.kind;
  padBadge.title =
    status.kind === "synced"
      ? `Synced ${new Date(status.at).toLocaleTimeString()}`
      : status.kind === "error"
        ? status.detail
        : status.kind === "conflict"
          ? "This device and another have both changed"
          : status.kind === "locked"
            ? "Locked — enter this pad's password"
            : "Syncing…";
}

const padsPanel = createPadsView(app, {
  backend,
  sync: padSync,
  getDoc: () => editor.getDoc(),
  onChange: () => saveState.flush(),
});
const pushToPad = debounce(() => void padSync.sync(), 1500);
const palette = createPalette(app, buildCommands);

// ---------------------------------------------------------------- session ---

function persistSession(): void {
  store.saveSession(
    session === null
      ? null
      : { ...session, anchors: editor.view.state.field(focusAnchorsField, false) ?? [] },
  );
}

/** Applies a transition to the live session, then persists and repaints. */
function mutate(transition: (current: FocusSession, now: number) => FocusSession): void {
  if (!session) return;
  session = transition(session, Date.now());
  persistSession();
  render();
}

function startFocus(targets: TaskTarget[]): void {
  if (targets.length === 0) return;
  if (session) endSession(false);
  const now = Date.now();
  session = beginSession({
    tasks: targets.map((target) => target.text),
    anchors: [],
    mode: settings.mode,
    durationSec: settings.mode === "countup" ? 0 : settings.focusSec,
    now,
  });
  finished = null;
  announcedExpiry = null;
  taskMissingSince = null;
  editor.anchorTo(targets.map((target) => target.from));
  persistSession();
  void notifier.request();
  // Started from a keypress, which is the only moment audio may be unlocked.
  chime.prepare();
  render();
}

/**
 * Restoring is itself an edit, so it lands in the undo history and the current
 * text becomes a snapshot in its own right -- restoring the wrong version is
 * recoverable too.
 */
function restoreVersion(doc: string): void {
  const next = recordSnapshot(snapshots, editor.getDoc(), Date.now(), { minGapMs: 0 });
  if (next !== snapshots) {
    snapshots = next;
    store.saveSnapshots(snapshots);
  }
  editor.setDoc(doc);
}

function endSession(completed: boolean): void {
  if (!session) return;
  if (completed) {
    finished = {
      task: describeTasks(session.tasks),
      extra: Math.max(0, session.tasks.length - 1),
      focused: formatDurationLong(totalFocusedSec(session, Date.now())),
      until: Date.now() + FINISHED_MS,
    };
  }
  session = null;
  announcedExpiry = null;
  taskMissingSince = null;
  editor.clearAnchor();
  persistSession();
  render();
  editor.focus();
}

/**
 * §13: complete the task, show what it cost, and move on. Ticking the box is
 * all this does -- `handleDocChange` is what ends the session, so ⌘D, a click
 * on the checkbox and this button all behave identically.
 */
function completeFocusedTask(): void {
  if (!session) return;
  const lines = resolveFocusedLines(editor.view.state, session.tasks);
  if (lines.length > 0) editor.completeAt(lines.map((line) => line.from));
  else endSession(true);
}

function handleDocChange(doc: string): void {
  saveState(doc);
  if (!session) return;
  // The session is done when every task in it is.
  const lines = resolveFocusedLines(editor.view.state, session.tasks);
  if (lines.length > 0 && lines.every((line) => parseLine(line.text).completed)) endSession(true);
}

/** "Pay taxes" on its own; "Pay taxes" plus a count when it is a group. */
function describeTasks(tasks: readonly string[]): string {
  return tasks[0] ?? "";
}

// ------------------------------------------------------------------ view ---

function panelView(now: number): PanelView {
  if (!session) {
    const waiting = focusTargetsIn(editor.view.state);
    if (finished && now < finished.until) {
      return {
        kind: "finished",
        task: finished.task,
        extra: finished.extra,
        focused: finished.focused,
      };
    }
    // Naming the task the cursor is on turns the panel from a description of
    // the shortcut into the control itself.
    const first = waiting[0]?.text ?? null;
    const more = waiting.length > 1 ? ` and ${waiting.length - 1} more` : "";
    return { kind: "idle", task: first === null ? null : `${first}${more}` };
  }

  // The live lines win over the titles captured at the start, so renaming a
  // task mid-session is reflected straight away.
  const lines = resolveFocusedLines(editor.view.state, session.tasks);
  const titles = lines.length > 0 ? lines.map((line) => parseLine(line.text).text.trim()) : [...session.tasks];
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
}

function render(): void {
  const now = Date.now();

  if (session) {
    const advanced = expireIfDue(session, now);
    if (advanced !== session) {
      session = advanced;
      persistSession();
    }
    if (session.phase === "expired" && announcedExpiry !== session.id) {
      announcedExpiry = session.id;
      notifier.notify("Focus complete", describeTasks(session.tasks));
      chime.play();
    }
    if (isBreakOver(session, now)) {
      notifier.notify("Break over", "Ready for the next one.");
      chime.play();
      endSession(false);
      return;
    }

    // A session belongs to a task. Once that task is gone from the document,
    // the panel is naming something that no longer exists.
    if (resolveFocusedLines(editor.view.state, session.tasks).length > 0) {
      taskMissingSince = null;
    } else {
      taskMissingSince ??= now;
      if (now - taskMissingSince > ORPHAN_GRACE_MS) {
        endSession(false);
        return;
      }
    }
  }

  const view = panelView(now);
  panel.render(view);

  if (view.kind === "running" || view.kind === "paused" || view.kind === "break") {
    document.title = `${view.clock} — ${view.task}`;
  } else {
    document.title = "Sprintpad";
  }
}

// -------------------------------------------------------------- commands ---

function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  store.saveSettings(settings);
  render();
}

function editorCommand(produce: (state: EditorState) => TransactionSpec | null) {
  return () => {
    const spec = produce(editor.view.state);
    if (spec) editor.view.dispatch({ ...spec, userEvent: "input" });
    editor.focus();
  };
}

/**
 * The palette holds what has no other route. Anything reachable by a key you
 * already know -- ⌘Enter, ⌘D, ⌘↑/↓, Tab, ⌘Z, ⌘F -- or by a button already on
 * screen during a session stays out of it, so the list is short enough to read.
 */
function buildCommands(): PaletteCommand[] {
  const cursorLine = editor.view.state.doc.lineAt(editor.view.state.selection.main.head);
  const onHeader = parseLine(cursorLine.text).kind === "header";

  return [
    { id: "timer", label: "Timer settings", run: () => timerSettings.open(() => editor.focus()) },
    { id: "clear", label: "Clear completed tasks", run: editorCommand(clearCompleted) },
    { id: "theme", label: "Toggle dark mode", run: () => updateSettings({ theme: theme.toggle() }) },
    {
      id: "header",
      label: onHeader ? "Turn into task" : "Turn into header",
      run: editorCommand(toggleHeader),
    },
    {
      id: "versions",
      label: "Restore an earlier version…",
      run: () => versions.open(() => editor.focus()),
    },
    {
      id: "pads",
      label: activePadId === null ? "Pads — sync across devices…" : `Pads — on “${activePadId}”…`,
      run: () => padsPanel.open(() => editor.focus()),
    },
  ];
}

function openPalette(): void {
  if (timerSettings.isOpen) timerSettings.close();
  if (shortcuts.isOpen) shortcuts.close();
  if (versions.isOpen) versions.close();
  if (padsPanel.isOpen) padsPanel.close();
  palette.open(() => editor.focus());
}

/**
 * ⇧⌘Space. One key for "keep the clock running": resume while paused, and
 * start another stretch once the timer is up.
 */
function toggleClock(): void {
  if (!session) return;
  if (session.phase === "expired") {
    mutate((current, now) => keepWorking(current, settings.mode, settings.focusSec, now));
  } else {
    mutate(togglePause);
  }
}

function takeBreak(): void {
  if (!session || session.phase === "break") return;
  mutate((current, now) => beginBreak(current, settings.breakSec, now));
}

function openShortcuts(): void {
  if (palette.isOpen) palette.close();
  if (timerSettings.isOpen) timerSettings.close();
  if (versions.isOpen) versions.close();
  if (padsPanel.isOpen) padsPanel.close();
  shortcuts.open(() => editor.focus());
}

// ----------------------------------------------------------------- setup ---

const stored = store.loadSession();
if (stored) {
  session = fromPersisted(stored);
  editor.restoreFocus(session.anchors, session.tasks);
}

barActions.append(barButton("⌘/", "?", openShortcuts), barButton("⌘K", "⋯", openPalette));

/**
 * Two labels: the shortcut where there is a keyboard, a plain glyph where
 * there is not. CSS picks between them, so there is no device detection to
 * get wrong.
 */
function barButton(shortcut: string, touchLabel: string, run: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sp-bar__button";

  const keys = document.createElement("span");
  keys.className = "sp-bar__keys";
  keys.textContent = shortcut;

  const glyph = document.createElement("span");
  glyph.className = "sp-bar__glyph";
  glyph.textContent = touchLabel;

  button.append(keys, glyph);
  button.addEventListener("click", run);
  return button;
}

const anyDialogOpen = () =>
  palette.isOpen ||
  timerSettings.isOpen ||
  shortcuts.isOpen ||
  versions.isOpen ||
  unlockPanel.isOpen ||
  padsPanel.isOpen;

// Global keys, live even when the editor does not have focus.
window.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;

  if (event.key === "Escape" && anyDialogOpen()) {
    // Handled here rather than on the dialogs themselves: clicking inside one
    // moves focus to the body, and Escape has to keep working from there.
    event.preventDefault();
    if (palette.isOpen) palette.close();
    else if (timerSettings.isOpen) timerSettings.close();
    else if (shortcuts.isOpen) shortcuts.close();
    else if (versions.isOpen) versions.close();
    else if (padsPanel.isOpen) padsPanel.close();
    else unlockPanel.close();
    return;
  }

  if (mod && !event.shiftKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openPalette();
    return;
  }
  if (mod && event.key === "/") {
    event.preventDefault();
    openShortcuts();
    return;
  }

  /*
   * Session controls are global on purpose: during a session the cursor is in
   * the document, so anything scoped to the timer panel is out of reach
   * without going for the mouse.
   */
  if (!session || !mod || !event.shiftKey || anyDialogOpen()) return;

  if (event.code === "Space") {
    event.preventDefault();
    toggleClock();
  } else if (event.key === "Enter") {
    event.preventDefault();
    completeFocusedTask();
  } else if (event.key === "." || event.key === ">") {
    event.preventDefault();
    endSession(false);
  } else if (event.key.toLowerCase() === "b") {
    event.preventDefault();
    takeBreak();
  }
});

window.addEventListener("beforeunload", () => {
  saveState.flush();
  persistSession();
});

// A paused tab stops ticking; catching up on return is what keeps the
// wall-clock timer honest.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    render();
    if (padSync.isUnlocked) void padSync.sync();
  }
});

setInterval(render, TICK_MS);
render();
editor.focus();

// The badge starts with whatever state the session opened in; onStatus only
// speaks up when that changes.
showPadStatus(padSync.status);

// Pick up anything another device wrote while this one was closed.
if (padSync.isUnlocked) void padSync.sync();

/*
 * On a pad URL that has never been opened here, ask for the password before
 * anything else. The root never reaches this: a plain load is always local.
 */
if (activePadId !== null && !padSync.isUnlocked) {
  unlockPanel.open(() => editor.focus());
}

// Clicking anywhere in the empty space below the document should put the
// cursor back in it -- the workpad is the interface.
workpad.addEventListener("mousedown", (event) => {
  if (event.target === workpad) {
    event.preventDefault();
    editor.focus();
  }
});
