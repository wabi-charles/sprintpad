import type { EditorState, TransactionSpec } from "@codemirror/state";
import { createEditor } from "./doc/editor";
import { clearCompleted, toggleHeader, type TaskTarget } from "./doc/edits";
import { focusAnchorField, resolveFocusedLine } from "./doc/focusField";
import { parseLine } from "./doc/grammar";
import { createStore, debounce, type Settings } from "./data/storage";
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
import { createShortcutsView } from "./ui/shortcutsView";
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
/** How long the "you finished it" line stays up before returning to idle. */
const FINISHED_MS = 5000;

const store = createStore(window.localStorage);
let settings: Settings = store.loadSettings();
let session: FocusSession | null = null;
let finished: { task: string; focused: string; until: number } | null = null;
let announcedExpiry: string | null = null;

const app = document.getElementById("app")!;

const header = document.createElement("header");
header.className = "sp-bar";
const brand = document.createElement("span");
brand.className = "sp-bar__brand";
brand.textContent = "SPRINTPAD";
const barActions = document.createElement("div");
barActions.className = "sp-bar__actions";
header.append(brand, barActions);

const focusHost = document.createElement("div");
const workpad = document.createElement("main");
workpad.className = "sp-workpad";
app.append(header, focusHost, workpad);

// The focus anchor moves with every edit, so it is saved alongside the
// document -- otherwise a reload would resume focus on a stale line.
const saveState = debounce((doc: string) => {
  store.saveDoc(doc);
  persistSession();
}, 300);
const notifier = createNotifier(() => settings.notifications);

const editor = createEditor({
  parent: workpad,
  doc: store.loadDoc() ?? STARTER_DOC,
  onDocChange: handleDocChange,
  onStartFocus: startFocus,
  onCommandPalette: openPalette,
  focusSnapshot: () => session?.taskText ?? null,
});

const theme = createTheme(settings.theme, (dark) => editor.setDark(dark));

const panel = createFocusPanel(focusHost, {
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
const palette = createPalette(app, buildCommands);

// ---------------------------------------------------------------- session ---

function persistSession(): void {
  store.saveSession(
    session === null
      ? null
      : { ...session, anchor: editor.view.state.field(focusAnchorField, false) ?? null },
  );
}

/** Applies a transition to the live session, then persists and repaints. */
function mutate(transition: (current: FocusSession, now: number) => FocusSession): void {
  if (!session) return;
  session = transition(session, Date.now());
  persistSession();
  render();
}

function startFocus(target: TaskTarget): void {
  if (session) endSession(false);
  const now = Date.now();
  session = beginSession({
    taskText: target.text,
    anchor: null,
    mode: settings.mode,
    durationSec: settings.mode === "countup" ? 0 : settings.focusSec,
    now,
  });
  finished = null;
  announcedExpiry = null;
  editor.anchorTo(target.from);
  persistSession();
  void notifier.request();
  render();
}

function endSession(completed: boolean): void {
  if (!session) return;
  if (completed) {
    finished = {
      task: session.taskText,
      focused: formatDurationLong(totalFocusedSec(session, Date.now())),
      until: Date.now() + FINISHED_MS,
    };
  }
  session = null;
  announcedExpiry = null;
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
  const line = resolveFocusedLine(editor.view.state, session.taskText);
  if (line) editor.completeAt(line.from);
  else endSession(true);
}

function handleDocChange(doc: string): void {
  saveState(doc);
  if (!session) return;
  const line = resolveFocusedLine(editor.view.state, session.taskText);
  if (line && parseLine(line.text).completed) endSession(true);
}

// ------------------------------------------------------------------ view ---

function panelView(now: number): PanelView {
  if (!session) {
    if (finished && now < finished.until) {
      return { kind: "finished", task: finished.task, focused: finished.focused };
    }
    return { kind: "idle" };
  }

  // The live line wins over the title captured at the start, so renaming a task
  // mid-session is reflected straight away.
  const line = resolveFocusedLine(editor.view.state, session.taskText);
  const task = line ? line.text.replace(/^[ \t]*\[[ xX]?\][ \t]?/, "") : session.taskText;

  if (session.phase === "expired") {
    return { kind: "expired", task, focused: formatDurationLong(totalFocusedSec(session, now)) };
  }

  const left = remainingSec(session.timer, now);
  const clock = formatClock(left ?? elapsedSec(session.timer, now));

  if (session.phase === "break") {
    return { kind: "break", task, clock, paused: !session.timer.running };
  }
  return {
    kind: session.phase === "paused" ? "paused" : "running",
    task,
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
      notifier.notify("Focus complete", session.taskText);
    }
    if (isBreakOver(session, now)) {
      notifier.notify("Break over", "Ready for the next one.");
      endSession(false);
      return;
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
  ];
}

function openPalette(): void {
  if (timerSettings.isOpen) timerSettings.close();
  if (shortcuts.isOpen) shortcuts.close();
  palette.open(() => editor.focus());
}

function openShortcuts(): void {
  if (palette.isOpen) palette.close();
  if (timerSettings.isOpen) timerSettings.close();
  shortcuts.open(() => editor.focus());
}

// ----------------------------------------------------------------- setup ---

const stored = store.loadSession();
if (stored) {
  session = fromPersisted(stored);
  editor.restoreFocus(session.anchor, session.taskText);
}

barActions.append(barButton("⌘/", openShortcuts), barButton("⌘K", openPalette));

function barButton(label: string, run: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sp-bar__button";
  button.textContent = label;
  button.addEventListener("click", run);
  return button;
}

// Global keys, live even when the editor does not have focus.
window.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === "Escape" && (palette.isOpen || timerSettings.isOpen || shortcuts.isOpen)) {
    // Handled here rather than on the dialogs themselves: clicking inside one
    // moves focus to the body, and Escape has to keep working from there.
    event.preventDefault();
    if (palette.isOpen) palette.close();
    else if (timerSettings.isOpen) timerSettings.close();
    else shortcuts.close();
  } else if (mod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openPalette();
  } else if (mod && event.key === "/") {
    event.preventDefault();
    openShortcuts();
  } else if (mod && event.shiftKey && event.code === "Space") {
    event.preventDefault();
    mutate(togglePause);
  }
});

window.addEventListener("beforeunload", () => {
  saveState.flush();
  persistSession();
});

// A paused tab stops ticking; catching up on return is what keeps the
// wall-clock timer honest.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});

setInterval(render, TICK_MS);
render();
editor.focus();

// Clicking anywhere in the empty space below the document should put the
// cursor back in it -- the workpad is the interface.
workpad.addEventListener("mousedown", (event) => {
  if (event.target === workpad) {
    event.preventDefault();
    editor.focus();
  }
});
