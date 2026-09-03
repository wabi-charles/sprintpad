import type { EditorState, TransactionSpec } from "@codemirror/state";
import { createEditor } from "./doc/editor";
import { clearCompleted, convertToTasks, type TaskTarget } from "./doc/edits";
import { focusAnchorField, resolveFocusedLine } from "./doc/focusField";
import { parseLine } from "./doc/grammar";
import { appendRecord, type FocusRecord } from "./data/history";
import { createStore, debounce, type Settings } from "./data/storage";
import { exportDoc, importDoc } from "./data/transfer";
import { createNotifier } from "./focus/notifications";
import { createFocusPanel, type PanelView } from "./focus/panel";
import {
  beginBreak,
  beginSession,
  expireIfDue,
  fromPersisted,
  isBreakOver,
  keepWorking,
  toRecord,
  togglePause,
  totalFocusedSec,
  type FocusSession,
} from "./focus/session";
import { elapsedSec, formatClock, formatDurationLong, remainingSec } from "./focus/timer";
import { createHistoryView } from "./ui/historyView";
import { createPalette, type PaletteCommand } from "./ui/palette";
import { createTheme } from "./ui/theme";
import "./styles.css";

/**
 * Wiring only. Everything with logic in it lives in the modules above; this
 * file decides what happens when, and owns the single render loop.
 */

const STARTER_DOC = [
  "TODAY",
  "[] Put the cursor on this line and press ⌘Enter to start focusing",
  "[] Press Enter to add a task, ⌘D to complete one",
  "  [] Tab indents, ⇧Tab outdents",
  "[] ⌘↑ and ⌘↓ move a task — position is priority",
  "",
  "OTHER",
  "[] Paste a list of plain lines and they become tasks",
  "[] Press ⌘K for everything else",
].join("\n");

const TICK_MS = 250;
/** How long the "you finished it" line stays up before returning to idle. */
const FINISHED_MS = 5000;

const store = createStore(window.localStorage);
let settings: Settings = store.loadSettings();
let log: FocusRecord[] = store.loadHistory();
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

const history = createHistoryView(app, () => log);
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
  if (session) logSession(false);
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

/** Starts focus on whatever the cursor is on; used by ⌘K. */
function startFocusAtCursor(): void {
  const target = editor.taskAtCursor();
  if (target) startFocus(target);
  else editor.focus();
}

function logSession(completed: boolean): FocusRecord | null {
  if (!session) return null;
  const record = toRecord(session, Date.now(), completed);
  const next = appendRecord(log, record);
  if (next.length !== log.length) {
    log = next;
    store.saveHistory(log);
  }
  return record;
}

function endSession(completed: boolean): void {
  if (!session) return;
  const record = logSession(completed);
  if (completed && record) {
    finished = {
      task: session.taskText,
      focused: formatDurationLong(record.seconds),
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

function askMinutes(label: string, current: number): number | null {
  const answer = window.prompt(label, String(Math.round(current / 60)));
  if (answer === null) return null;
  const minutes = Number(answer.trim());
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes * 60);
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

function durationCommands(): PaletteCommand[] {
  const presets = [25, 50, 60, 90];
  const commands: PaletteCommand[] = presets.map((minutes) => ({
    id: `duration-${minutes}`,
    label: `Focus duration: ${minutes} minutes`,
    hint: settings.mode === "countdown" && settings.focusSec === minutes * 60 ? "current" : undefined,
    run: () => updateSettings({ mode: "countdown", focusSec: minutes * 60 }),
  }));

  commands.push({
    id: "duration-custom",
    label: "Focus duration: custom…",
    run: () => {
      const seconds = askMinutes("Focus length in minutes", settings.focusSec);
      if (seconds !== null) updateSettings({ mode: "countdown", focusSec: seconds });
    },
  });
  commands.push({
    id: "duration-countup",
    label: "Focus duration: count up",
    hint: settings.mode === "countup" ? "current" : undefined,
    run: () => updateSettings({ mode: "countup" }),
  });
  commands.push({
    id: "break-custom",
    label: `Break length: ${Math.round(settings.breakSec / 60)} minutes…`,
    run: () => {
      const seconds = askMinutes("Break length in minutes", settings.breakSec);
      if (seconds !== null) updateSettings({ breakSec: seconds });
    },
  });
  return commands;
}

function buildCommands(): PaletteCommand[] {
  return [
    { id: "focus", label: "Start focus on current task", hint: "⌘⏎", run: startFocusAtCursor },
    ...(session
      ? [
          { id: "focus-done", label: "Complete focused task", run: completeFocusedTask },
          { id: "focus-pause", label: "Pause or resume timer", hint: "Space", run: () => mutate(togglePause) },
          { id: "focus-stop", label: "Stop focus session", run: () => endSession(false) },
        ]
      : []),
    { id: "move-up", label: "Move task up", hint: "⌘↑", run: () => editor.moveLineUp() },
    { id: "move-down", label: "Move task down", hint: "⌘↓", run: () => editor.moveLineDown() },
    { id: "convert", label: "Convert lines to tasks", run: editorCommand(convertToTasks) },
    { id: "clear", label: "Clear completed tasks", run: editorCommand(clearCompleted) },
    { id: "search", label: "Search", hint: "⌘F", run: () => editor.openSearch() },
    { id: "undo", label: "Undo", hint: "⌘Z", run: () => editor.undo() },
    { id: "redo", label: "Redo", hint: "⇧⌘Z", run: () => editor.redo() },
    { id: "history", label: "Today's focus", run: () => history.open(() => editor.focus()) },
    ...durationCommands(),
    {
      id: "theme",
      label: "Toggle dark mode",
      run: () => updateSettings({ theme: theme.toggle() }),
    },
    {
      id: "notifications",
      label: settings.notifications ? "Turn notifications off" : "Turn notifications on",
      run: () => {
        updateSettings({ notifications: !settings.notifications });
        void notifier.request();
      },
    },
    { id: "export", label: "Export as Markdown", run: () => exportDoc(editor.getDoc()) },
    {
      id: "import",
      label: "Import from file…",
      run: async () => {
        const text = await importDoc();
        if (text !== null) editor.setDoc(text);
        editor.focus();
      },
    },
  ];
}

function openPalette(): void {
  if (history.isOpen) history.close();
  palette.open(() => editor.focus());
}

// ----------------------------------------------------------------- setup ---

const stored = store.loadSession();
if (stored) {
  session = fromPersisted(stored);
  editor.restoreFocus(session.anchor, session.taskText);
}

barActions.append(
  barButton("Today", () => history.open(() => editor.focus())),
  barButton("⌘K", openPalette),
);

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
  if (mod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openPalette();
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
