import type { EditorState, TransactionSpec } from "@codemirror/state";
import { createCore, type AppCore, type DocSurface } from "../core/app";
import { createEditor, type Editor } from "../doc/editor";
import { clearCompleted, focusTargetsIn, toggleHeader } from "../doc/edits";
import { focusAnchorsField, resolveFocusedLines } from "../doc/focusField";
import { parseLine } from "../doc/grammar";
import { createFocusPanel } from "../focus/panel";
import { createPalette, type PaletteCommand } from "../ui/palette";
import { createSettingsView } from "../ui/settingsView";
import type { SyncStatus } from "../sync/pad";
import { createShortcutsView } from "../ui/shortcutsView";
import { createSnapshotsView } from "../ui/snapshotsView";
import { createPadsView } from "../ui/padsView";
import { createTouchBar } from "../ui/touchBar";
import { createConflictView } from "../ui/conflictView";
import { createUnlockView } from "../ui/unlockView";
import { createTheme } from "../ui/theme";

/**
 * The keyboard-first shell: a text editor with a timer attached.
 *
 * Wiring only. Everything with logic in it lives in core or in the modules
 * above; this file decides what happens when, and owns the screen.
 */
export function startDesktop(): void {
  const app = document.getElementById("app")!;

  const header = document.createElement("header");
  header.className = "sp-bar";
  const brand = document.createElement("span");
  brand.className = "sp-bar__brand";
  brand.textContent = "SPRINTPAD";

  /*
   * Which list you are looking at. A pad and the local list are identical on
   * screen, so the badge is always present rather than appearing only on a
   * pad: "Local" is a statement, where an empty space is merely an absence,
   * and it gives the pad manager somewhere to be found from the root.
   */
  const padBadge = document.createElement("button");
  padBadge.type = "button";
  padBadge.className = "sp-bar__pad";
  const barActions = document.createElement("div");
  barActions.className = "sp-bar__actions";
  header.append(brand, padBadge, barActions);

  const focusHost = document.createElement("div");
  const workpad = document.createElement("main");
  workpad.className = "sp-workpad";
  const touchHost = document.createElement("div");
  app.append(header, focusHost, touchHost, workpad);

  let editor!: Editor;

  const core: AppCore = createCore((hooks): DocSurface => {
    editor = createEditor({
      parent: workpad,
      doc: hooks.initialDoc,
      onDocChange: hooks.onDocChange,
      onStartFocus: (targets) =>
        core.sessions.start(
          targets.map((target) => ({
            from: target.from,
            text: target.text,
            completed: target.completed,
          })),
        ),
      onCommandPalette: openPalette,
      focusSnapshot: () => core.sessions.session?.tasks ?? null,
    });

    return {
      getDoc: () => editor.getDoc(),
      setDoc: (doc, options) => editor.setDoc(doc, options),
      focus: () => editor.focus(),
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
      clearAnchor: () => editor.clearAnchor(),
      completeAt: (positions) => editor.completeAt(positions),
      anchors: () => editor.view.state.field(focusAnchorsField, false) ?? [],
      restoreFocus: (anchors, tasks) => editor.restoreFocus(anchors, tasks),
    };
  });

  padBadge.addEventListener("click", () => {
    // A conflicted pad has one thing worth doing, and this is the only badge
    // there is to reach it from.
    if (core.sync.status.kind === "conflict") conflictPanel.open(() => editor.focus());
    else padsPanel.open(() => editor.focus());
  });
  {
    const name = document.createElement("span");
    name.className = "sp-bar__padname";
    name.textContent = core.padId ?? "Local";
    const dot = document.createElement("span");
    dot.className = "sp-bar__dot";
    padBadge.append(name, dot);
  }

  const theme = createTheme(core.settings().theme, (dark) => editor.setDark(dark));
  createTouchBar(touchHost, () => editor);

  const panel = createFocusPanel(focusHost, {
    start: () => core.sessions.startAtCursor(),
    togglePause: () => core.sessions.togglePause(),
    done: () => core.sessions.complete(),
    stop: () => core.sessions.stop(),
    keepWorking: () => core.sessions.toggleClock(),
    takeBreak: () => core.sessions.takeBreak(),
    endBreak: () => core.sessions.stop(),
  });

  const timerSettings = createSettingsView(app, core.settings, (patch) =>
    core.updateSettings(patch),
  );
  const shortcuts = createShortcutsView(app);
  const versions = createSnapshotsView(app, core.snapshots, core.restoreVersion);
  const unlockPanel = createUnlockView(app, core.sync, () => core.flush());
  const conflictPanel = createConflictView(app, core.sync, () => core.flush());
  const padsPanel = createPadsView(app, {
    backend: core.backend,
    sync: core.sync,
    getDoc: () => editor.getDoc(),
    onChange: () => core.flush(),
  });
  const palette = createPalette(app, buildCommands);

  function showPadStatus(status: SyncStatus): void {
    padBadge.dataset.state = status.kind;
    if (core.padId === null) {
      padBadge.title = "This list stays in this browser";
      return;
    }
    padBadge.title =
      status.kind === "synced"
        ? `Synced ${new Date(status.at).toLocaleTimeString()}`
        : status.kind === "error"
          ? status.detail
          : status.kind === "conflict"
            ? "Both devices changed the same lines — click to settle it"
            : status.kind === "locked"
              ? "Locked — enter this pad's password"
              : "Syncing…";
  }

  core.onSyncStatus((status) => {
    unlockPanel.refresh();
    padsPanel.refresh();
    conflictPanel.refresh();
    showPadStatus(status);
    // Sync is stopped until this is answered, so it is asked rather than left
    // in a badge nobody looks at. Merging first is what makes it rare enough
    // to be worth interrupting for.
    if (status.kind === "conflict" && !conflictPanel.isOpen && !unlockPanel.isOpen) {
      conflictPanel.open(() => editor.focus());
    }
  });

  core.onTick(() => panel.render(core.sessions.view()));

  function editorCommand(produce: (state: EditorState) => TransactionSpec | null) {
    return () => {
      const spec = produce(editor.view.state);
      if (spec) editor.view.dispatch({ ...spec, userEvent: "input" });
      editor.focus();
    };
  }

  /**
   * The palette holds what has no other route. Anything reachable by a key you
   * already know -- ⌘Enter, ⌘D, ⌘↑/↓, Tab, ⌘Z, ⌘F -- or by a button already
   * on screen during a session stays out of it, so the list is short enough to
   * read.
   */
  function buildCommands(): PaletteCommand[] {
    const cursorLine = editor.view.state.doc.lineAt(editor.view.state.selection.main.head);
    const onHeader = parseLine(cursorLine.text).kind === "header";

    return [
      { id: "timer", label: "Timer settings", run: () => timerSettings.open(() => editor.focus()) },
      { id: "clear", label: "Clear completed tasks", run: editorCommand(clearCompleted) },
      {
        id: "theme",
        label: "Toggle dark mode",
        run: () => core.updateSettings({ theme: theme.toggle() }),
      },
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

  barActions.append(barButton("⌘/", "?", openShortcuts), barButton("⌘K", "⋯", openPalette));

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
      // Handled here rather than on the dialogs themselves: clicking inside
      // one moves focus to the body, and Escape has to keep working from
      // there.
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
     * Session controls are global on purpose: during a session the cursor is
     * in the document, so anything scoped to the timer panel is out of reach
     * without going for the mouse.
     */
    if (!core.sessions.session || !mod || !event.shiftKey || anyDialogOpen()) return;

    if (event.code === "Space") {
      event.preventDefault();
      core.sessions.toggleClock();
    } else if (event.key === "Enter") {
      event.preventDefault();
      core.sessions.complete();
    } else if (event.key === "." || event.key === ">") {
      event.preventDefault();
      core.sessions.stop();
    } else if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      core.sessions.takeBreak();
    }
  });

  // Clicking anywhere in the empty space below the document should put the
  // cursor back in it -- the workpad is the interface.
  workpad.addEventListener("mousedown", (event) => {
    if (event.target === workpad) {
      event.preventDefault();
      editor.focus();
    }
  });

  core.start();
  editor.focus();

  /*
   * On a pad URL that has never been opened here, ask for the password before
   * anything else. The root never reaches this: a plain load is always local.
   */
  if (core.padId !== null && !core.sync.isUnlocked) {
    unlockPanel.open(() => editor.focus());
  }
}
