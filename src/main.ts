import type { EditorState, TransactionSpec } from "@codemirror/state";
import { createEditor } from "./doc/editor";
import { clearCompleted, focusTargetsIn, toggleHeader } from "./doc/edits";
import { focusAnchorsField, resolveFocusedLines } from "./doc/focusField";
import { parseLine } from "./doc/grammar";
import { recordSnapshot, type Snapshot } from "./data/snapshots";
import { browserStorage, createStore, debounce, type Settings } from "./data/storage";
import { createChime } from "./focus/chime";
import { createNotifier } from "./focus/notifications";
import { createSessionController } from "./focus/lifecycle";
import { createFocusPanel } from "./focus/panel";
import { createPalette, type PaletteCommand } from "./ui/palette";
import { createSettingsView } from "./ui/settingsView";
import { createPadSync, type SyncStatus } from "./sync/pad";
import { padIdFromPath } from "./sync/padId";
import { createShortcutsView } from "./ui/shortcutsView";
import { createSnapshotsView } from "./ui/snapshotsView";
import { createPadsView } from "./ui/padsView";
import { createTouchBar } from "./ui/touchBar";
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
let snapshots: Snapshot[] = store.loadSnapshots();

const app = document.getElementById("app")!;

const header = document.createElement("header");
header.className = "sp-bar";
const brand = document.createElement("span");
brand.className = "sp-bar__brand";
brand.textContent = "SPRINTPAD";

/*
 * Which list you are looking at. A pad and the local list are identical on
 * screen, so the badge is always present rather than appearing only on a pad:
 * "Local" is a statement, where an empty space is merely an absence, and it
 * gives the pad manager somewhere to be found from the root.
 */
const padBadge = document.createElement("button");
padBadge.type = "button";
padBadge.className = "sp-bar__pad";
{
  const name = document.createElement("span");
  name.className = "sp-bar__padname";
  name.textContent = activePadId ?? "Local";
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
const touchHost = document.createElement("div");
app.append(header, focusHost, touchHost, workpad);

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
  if (padSync.isUnlocked) pushToPad();
}, 300);
const notifier = createNotifier(() => settings.notifications);
const chime = createChime(() => settings.sound);

const editor = createEditor({
  parent: workpad,
  doc: initialDoc,
  onDocChange: handleDocChange,
  onStartFocus: (targets) =>
    sessions.start(
      targets.map((target) => ({
        from: target.from,
        text: target.text,
        completed: target.completed,
      })),
    ),
  onCommandPalette: openPalette,
  focusSnapshot: () => sessions.session?.tasks ?? null,
});

const theme = createTheme(settings.theme, (dark) => editor.setDark(dark));
createTouchBar(touchHost, () => editor);

const panel = createFocusPanel(focusHost, {
  start: () => sessions.startAtCursor(),
  togglePause: () => sessions.togglePause(),
  done: () => sessions.complete(),
  stop: () => sessions.stop(),
  keepWorking: () => sessions.toggleClock(),
  takeBreak: () => sessions.takeBreak(),
  endBreak: () => sessions.stop(),
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
  padBadge.dataset.state = status.kind;
  if (activePadId === null) {
    padBadge.title = "This list stays in this browser";
    return;
  }
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

const sessions = createSessionController({
  now: () => Date.now(),
  settings: () => settings,
  locate: (tasks) =>
    resolveFocusedLines(editor.view.state, tasks).map((line) => ({
      from: line.from,
      text: parseLine(line.text).text.trim(),
      completed: parseLine(line.text).completed,
    })),
  candidates: () =>
    focusTargetsIn(editor.view.state).map((target) => ({
      from: target.from,
      text: target.text,
      completed: target.completed,
    })),
  anchorTo: (positions) => editor.anchorTo(positions),
  clearAnchor: () => {
    editor.clearAnchor();
    editor.focus();
  },
  completeAt: (positions) => editor.completeAt(positions),
  persist: (session) =>
    store.saveSession(
      session === null
        ? null
        : { ...session, anchors: editor.view.state.field(focusAnchorsField, false) ?? [] },
    ),
  notify: (title, body) => notifier.notify(title, body),
  chime: () => chime.play(),
  unlockAudio: () => {
    void notifier.request();
    chime.prepare();
  },
});

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

function handleDocChange(doc: string): void {
  saveState(doc);
  sessions.noteDocChange();
}

function render(): void {
  sessions.tick();
  const view = sessions.view();
  panel.render(view);

  document.title =
    view.kind === "running" || view.kind === "paused" || view.kind === "break"
      ? `${view.clock} — ${view.task}`
      : "Sprintpad";
}

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
  ];
}

function openPalette(): void {
  if (timerSettings.isOpen) timerSettings.close();
  if (shortcuts.isOpen) shortcuts.close();
  if (versions.isOpen) versions.close();
  if (padsPanel.isOpen) padsPanel.close();
  palette.open(() => editor.focus());
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
sessions.restore(stored);
if (stored) editor.restoreFocus(stored.anchors, stored.tasks);

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
  if (!sessions.session || !mod || !event.shiftKey || anyDialogOpen()) return;

  if (event.code === "Space") {
    event.preventDefault();
    sessions.toggleClock();
  } else if (event.key === "Enter") {
    event.preventDefault();
    sessions.complete();
  } else if (event.key === "." || event.key === ">") {
    event.preventDefault();
    sessions.stop();
  } else if (event.key.toLowerCase() === "b") {
    event.preventDefault();
    sessions.takeBreak();
  }
});

window.addEventListener("beforeunload", () => {
  saveState.flush();
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
