import { createCore, type AppCore, type DocSurface } from "../core/app";
import { parseLine } from "../doc/grammar";
import { createConflictView } from "../ui/conflictView";
import { createPadsView } from "../ui/padsView";
import { createSettingsView } from "../ui/settingsView";
import { createSnapshotsView } from "../ui/snapshotsView";
import { createTheme } from "../ui/theme";
import { createUnlockView } from "../ui/unlockView";
import type { SyncStatus } from "../sync/pad";
import { createFocusSheet } from "./focusSheet";
import { createListView } from "./listView";
import { createMenuSheet, createTextView } from "./menuSheet";
import { rowsFor, type Row } from "./rows";
import type { Applied } from "./ops";
import "./mobile.css";

/**
 * Sprintpad for thumbs.
 *
 * The desktop shell is a text editor because ⌘↑ and Tab are what make it fast.
 * None of that exists here, so this is a list: tap to complete, tap to edit,
 * swipe for the rest. It is a different interface over the same document --
 * every edit runs the same functions the editor runs, and the storage, sync
 * and timer are the core's, untouched.
 */
export function startMobile(): void {
  const app = document.getElementById("app")!;
  app.classList.add("sp-m");

  const header = document.createElement("header");
  header.className = "sp-m-bar";

  const padButton = document.createElement("button");
  padButton.type = "button";
  padButton.className = "sp-m-bar__pad";
  const padName = document.createElement("span");
  padName.className = "sp-m-bar__name";
  const padDot = document.createElement("span");
  padDot.className = "sp-m-bar__dot";
  padButton.append(padName, padDot);

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "sp-m-bar__menu";
  menuButton.setAttribute("aria-label", "Menu");
  menuButton.textContent = "⋯";

  header.append(padButton, menuButton);
  app.append(header);

  /*
   * Everything that lives at the bottom of the screen shares one column, so
   * the timer and the add button cannot end up on top of each other -- and the
   * list is padded by however tall that column happens to be.
   */
  const dock = document.createElement("div");
  dock.className = "sp-m-dock";

  /** The row the user last touched: what a focus session starts on. */
  let selected: number | null = null;
  /** Focus anchors, as character offsets, kept in step with the text. */
  let anchors: number[] = [];

  let list!: ReturnType<typeof createListView>;

  /*
   * The desktop's placeholder teaches ⌘/, which is not a key anyone has here.
   * Same shape, same job -- it tells you what to do with the thing in front
   * of you, and here that is a finger.
   */
  const STARTER = [
    "# TODAY",
    "Your first task",
    "Tap a task to rename it",
    "",
    "# BACKLOG",
    "Something that can wait",
  ].join("\n");

  const core: AppCore = createCore((hooks): DocSurface => {
    let doc = hooks.initialDoc;

    function set(next: string, notify = true): void {
      doc = next;
      if (notify) hooks.onDocChange(doc);
      list?.render();
    }

    function tasksAt(positions: readonly number[]): Row[] {
      const rows = rowsFor(doc);
      return positions
        .map((at) => rows.find((row) => at >= row.from && at <= row.to))
        .filter((row): row is Row => row !== undefined && row.kind === "task");
    }

    list = createListView(app, {
      doc: () => doc,
      change: (applied: Applied) => set(applied.doc),
      startFocus: (row) => {
        selected = row.from;
        core.sessions.start([{ from: row.from, text: row.text, completed: row.done }]);
      },
      focused: () => anchors,
      select: (from) => (selected = from),
    });

    return {
      getDoc: () => doc,
      setDoc: (next) => set(next),
      focus: () => {},

      /**
       * Anchors first, titles second -- the same order the editor resolves in,
       * so a task that was renamed while focused is still found and one that
       * moved is not confused with its neighbour.
       */
      locate: (titles) => {
        const byAnchor = tasksAt(anchors);
        const rows =
          byAnchor.length === titles.length
            ? byAnchor
            : rowsFor(doc).filter((row) => row.kind === "task" && titles.includes(row.text));
        return rows.map((row) => ({ from: row.from, text: row.text, completed: row.done }));
      },

      /** Whatever was last touched, or the first task still open. */
      candidates: () => {
        const rows = rowsFor(doc);
        const chosen =
          rows.find((row) => selected !== null && row.from === selected && row.kind === "task") ??
          rows.find((row) => row.kind === "task" && !row.done);
        return chosen ? [{ from: chosen.from, text: chosen.text, completed: chosen.done }] : [];
      },

      anchorTo: (positions) => {
        anchors = [...positions];
        list.render();
      },
      clearAnchor: () => {
        anchors = [];
        list.render();
      },
      completeAt: (positions) => {
        let next = doc;
        // Back to front, so an earlier edit cannot shift a later position.
        for (const at of [...positions].sort((a, b) => b - a)) {
          const row = rowsFor(next).find((r) => at >= r.from && at <= r.to);
          if (!row || row.kind !== "task" || row.done) continue;
          const parsed = parseLine(row.raw);
          const raw = `${parsed.indentText}[x] ${parsed.text}`;
          next = next.slice(0, row.from) + raw + next.slice(row.to);
        }
        if (next !== doc) set(next);
      },
      anchors: () => anchors,
      restoreFocus: (stored) => {
        anchors = [...stored];
        list.render();
      },
    };
  }, { starterDoc: STARTER });

  // ------------------------------------------------------------- chrome ---

  const theme = createTheme(core.settings().theme, () => {});
  const focusSheet = createFocusSheet(dock, {
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
  const versions = createSnapshotsView(app, core.snapshots, core.restoreVersion);
  const unlockPanel = createUnlockView(app, core.sync, () => core.flush());
  const conflictPanel = createConflictView(app, core.sync, () => core.flush());
  const padsPanel = createPadsView(app, {
    backend: core.backend,
    sync: core.sync,
    getDoc: () => core.surface.getDoc(),
    onChange: () => core.flush(),
  });

  const textView = createTextView(
    app,
    () => core.surface.getDoc(),
    (doc) => core.restoreVersion(doc),
  );

  const menu = createMenuSheet(app, () => [
    { label: "Pads and sync", detail: core.padId ?? "Local", run: () => padsPanel.open(() => {}) },
    { label: "Timer", detail: timerDetail(), run: () => timerSettings.open(() => {}) },
    { label: "Edit as text", run: () => textView.open() },
    { label: "Restore an earlier version", run: () => versions.open(() => {}) },
    {
      label: "Dark mode",
      detail: core.settings().theme,
      run: () => core.updateSettings({ theme: theme.toggle() }),
    },
    {
      label: "Use the desktop layout",
      detail: "keyboard and mouse",
      run: () => location.assign(`${location.pathname}?ui=desktop`),
    },
  ]);

  function timerDetail(): string {
    const settings = core.settings();
    return settings.mode === "countup" ? "count up" : `${Math.round(settings.focusSec / 60)} min`;
  }

  padButton.addEventListener("click", () => {
    if (core.sync.status.kind === "conflict") conflictPanel.open(() => {});
    else padsPanel.open(() => {});
  });
  menuButton.addEventListener("click", () => menu.open());

  // ------------------------------------------------------- editing bar ---

  /**
   * The bar above the keyboard. Just a way out of the row you are typing in:
   * indenting and reordering are drags now, not buttons, because a list you
   * can pick things up and move is what a touch screen is actually good at.
   */
  const accessory = document.createElement("div");
  accessory.className = "sp-m-accessory";
  accessory.hidden = true;

  function accessoryButton(label: string, name: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sp-m-accessory__button";
    button.textContent = label;
    button.setAttribute("aria-label", name);
    // The press must not take focus, or the keyboard drops and the row closes.
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", run);
    return button;
  }

  accessory.append(accessoryButton("Done", "Stop editing", () => list.stopEditing()));
  app.append(accessory);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "sp-m-add";
  addButton.textContent = "+ New Task";
  addButton.addEventListener("click", () => list.addTask());
  dock.append(addButton);
  app.append(dock);

  /*
   * The on-screen keyboard does not resize the window, it shrinks the visual
   * viewport -- so anything that must sit above it has to be told where the
   * bottom is now.
   */
  const viewport = window.visualViewport;
  function followKeyboard(): void {
    const inset = viewport ? window.innerHeight - viewport.height - viewport.offsetTop : 0;
    accessory.style.bottom = `${Math.max(0, inset)}px`;
  }
  viewport?.addEventListener("resize", followKeyboard);
  viewport?.addEventListener("scroll", followKeyboard);

  function showPadStatus(status: SyncStatus): void {
    padButton.dataset.state = status.kind;
    padName.textContent = core.padId ?? "Local";
  }

  core.onSyncStatus((status) => {
    unlockPanel.refresh();
    padsPanel.refresh();
    conflictPanel.refresh();
    showPadStatus(status);
    if (status.kind === "conflict" && !conflictPanel.isOpen && !unlockPanel.isOpen) {
      conflictPanel.open(() => {});
    }
  });

  core.onTick(() => {
    focusSheet.render(core.sessions.view());
    const editing = list.isEditing;
    accessory.hidden = !editing;
    // While typing, the keyboard owns the bottom of the screen; while a
    // session is expanded, the session does.
    addButton.hidden = editing || focusSheet.isExpanded;
    dock.hidden = editing && !focusSheet.isVisible;
    if (editing) followKeyboard();
    listRoom();
  });

  /** Keep the last row clear of whatever the dock has grown to. */
  function listRoom(): void {
    const height = dock.hidden ? 0 : dock.getBoundingClientRect().height;
    document.documentElement.style.setProperty("--sp-m-dock", `${Math.round(height)}px`);
  }

  core.start();
  list.render();

  if (core.padId !== null && !core.sync.isUnlocked) {
    unlockPanel.open(() => {});
  }
}
