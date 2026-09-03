import { defaultKeymap, history, historyKeymap, moveLineDown, moveLineUp, redo, undo } from "@codemirror/commands";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { indentTasks, insertTaskLine, outdentTasks, toggleTaskDone } from "./commands";
import { sprintpadDecorations } from "./decorations";
import { completeLineAt, focusTargetAt, nextOpenTaskAfter, toggleDone, type TaskTarget } from "./edits";
import {
  anchorForLine,
  focusAnchorField,
  reanchorTo,
  resolveFocusedLine,
  setFocusAnchor,
} from "./focusField";
import { INDENT_UNIT, parseLine } from "./grammar";
import { transformPastedText } from "./paste";

export interface EditorHooks {
  parent: HTMLElement;
  doc: string;
  onDocChange(doc: string): void;
  /** Cmd-Enter on a task line. */
  onStartFocus(target: TaskTarget): void;
  onCommandPalette(): void;
  /** The title to fall back to when the focus anchor needs re-attaching. */
  focusSnapshot(): string | null;
}

const themeCompartment = new Compartment();

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--sp-font-doc)",
    lineHeight: "1.75",
    padding: "8px 0 40vh",
  },
  ".cm-content": { caretColor: "var(--sp-accent)" },
  ".cm-line": { padding: "0 4px" },
});

export function createEditor(hooks: EditorHooks) {
  const startFocus = (view: EditorView): boolean => {
    const target = focusTargetAt(view.state);
    if (!target) return false;
    hooks.onStartFocus(target);
    return true;
  };

  const sprintpadKeymap = Prec.highest(
    keymap.of([
      { key: "Enter", run: insertTaskLine },
      { key: "Mod-Enter", run: startFocus, preventDefault: true },
      { key: "Mod-d", run: toggleTaskDone, preventDefault: true },
      { key: "Mod-ArrowUp", run: moveLineUp, preventDefault: true },
      { key: "Mod-ArrowDown", run: moveLineDown, preventDefault: true },
      { key: "Alt-ArrowUp", run: moveLineUp, preventDefault: true },
      { key: "Alt-ArrowDown", run: moveLineDown, preventDefault: true },
      { key: "Tab", run: indentTasks },
      { key: "Shift-Tab", run: outdentTasks },
      {
        key: "Mod-k",
        preventDefault: true,
        run: () => {
          hooks.onCommandPalette();
          return true;
        },
      },
    ]),
  );

  /**
   * §16: a multi-line paste of bare text becomes tasks. Anything already
   * carrying markers is inserted verbatim so in-app copy/paste is lossless.
   */
  const pasteHandler = EditorView.domEventHandlers({
    paste(event, view) {
      const raw = event.clipboardData?.getData("text/plain");
      if (!raw) return false;
      const range = view.state.selection.main;
      const atLineStart = range.from === view.state.doc.lineAt(range.from).from;
      const transformed = transformPastedText(raw, { atLineStart });
      if (transformed === null) return false;
      event.preventDefault();
      view.dispatch(view.state.replaceSelection(transformed));
      return true;
    },
  });

  const view = new EditorView({
    parent: hooks.parent,
    state: EditorState.create({
      doc: hooks.doc,
      extensions: [
        history(),
        search({ top: true }),
        highlightSelectionMatches(),
        focusAnchorField,
        sprintpadDecorations((clicked, pos) => {
          // Toggle the clicked line without disturbing the real selection.
          const at = clicked.state.update({ selection: { anchor: pos } }).state;
          const spec = toggleDone(at);
          if (spec) clicked.dispatch({ ...spec, userEvent: "input" });
        }),
        sprintpadKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorState.tabSize.of(INDENT_UNIT.length),
        EditorView.lineWrapping,
        placeholder("Type a task, or paste a list…"),
        pasteHandler,
        baseTheme,
        themeCompartment.of(EditorView.theme({}, { dark: false })),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          hooks.onDocChange(update.state.doc.toString());
          const snapshot = hooks.focusSnapshot();
          if (snapshot === null) return;
          const anchor = reanchorTo(update.state, snapshot);
          if (anchor !== null) update.view.dispatch({ effects: setFocusAnchor.of(anchor) });
        }),
      ],
    }),
  });

  return {
    view,

    focus(): void {
      view.focus();
    },

    getDoc(): string {
      return view.state.doc.toString();
    },

    setDoc(doc: string): void {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    },

    setDark(dark: boolean): void {
      view.dispatch({
        effects: themeCompartment.reconfigure(EditorView.theme({}, { dark })),
      });
    },

    /** Anchors a focus session to the task the cursor is on. */
    anchorTo(pos: number): void {
      const line = view.state.doc.lineAt(pos);
      view.dispatch({ effects: setFocusAnchor.of(anchorForLine(line)) });
    },

    clearAnchor(): void {
      view.dispatch({ effects: setFocusAnchor.of(null) });
    },

    /**
     * Re-attaches a session restored from storage. The stored position is only
     * trusted when the line it names still holds that task; otherwise the title
     * decides, so a document edited in another tab cannot focus the wrong line.
     */
    restoreFocus(anchor: number | null, taskText: string): void {
      const { state } = view;
      let line = null;
      if (anchor !== null && anchor <= state.doc.length) {
        const candidate = state.doc.lineAt(anchor);
        const parsed = parseLine(candidate.text);
        if (parsed.kind === "task" && parsed.text.trim() === taskText.trim()) line = candidate;
      }
      line ??= resolveFocusedLine(state, taskText);
      view.dispatch({ effects: setFocusAnchor.of(line ? anchorForLine(line) : null) });
    },

    taskAtCursor(): TaskTarget | null {
      return focusTargetAt(view.state);
    },

    /** Marks a line complete and parks the cursor on the next open task (§13). */
    completeAt(pos: number): void {
      const spec = completeLineAt(view.state, pos);
      if (spec) view.dispatch({ ...spec, userEvent: "input" });
      const next = nextOpenTaskAfter(view.state, pos);
      if (next) view.dispatch({ selection: { anchor: next.to }, scrollIntoView: true });
      view.focus();
    },

    openSearch(): void {
      openSearchPanel(view);
    },

    undo(): void {
      undo(view);
    },

    redo(): void {
      redo(view);
    },

    moveLineUp(): void {
      moveLineUp(view);
      view.focus();
    },

    moveLineDown(): void {
      moveLineDown(view);
      view.focus();
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;
