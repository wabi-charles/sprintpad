import { defaultKeymap, history, historyKeymap, moveLineDown, moveLineUp } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
import { deleteLineHead, indentTasks, insertTaskLine, outdentTasks, toggleTaskDone } from "./commands";
import { sprintpadDecorations } from "./decorations";
import { completeLineAt, focusTargetsIn, nextOpenTaskAfter, toggleDone, type TaskTarget } from "./edits";
import {
  anchorForLine,
  focusAnchorsField,
  reanchorTo,
  resolveFocusedLines,
  setFocusAnchors,
} from "./focusField";
import { INDENT_UNIT, parseLine } from "./grammar";
import { markerInputAction, setSwallowedMarker, swallowedMarkerField } from "./markerInput";
import { pendingTaskField, setPendingTask } from "./pendingTask";
import { transformPastedText } from "./paste";

export interface EditorHooks {
  parent: HTMLElement;
  doc: string;
  onDocChange(doc: string): void;
  /** Cmd-Enter: the task at the cursor, or every task the selection covers. */
  onStartFocus(targets: TaskTarget[]): void;
  onCommandPalette(): void;
  /** The titles to fall back to when the focus anchors need re-attaching. */
  focusSnapshot(): readonly string[] | null;
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
  ".cm-content": { caretColor: "transparent" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "1.5px solid var(--sp-accent)",
    marginLeft: "0",
  },
  /*
   * Left padding is the gutter the checkbox is drawn into, and must be in px:
   * `em` resolves against each line's own font-size, so headers (11px) would
   * get a different gutter from tasks (15px) -- and `rectanglesForRange` reads
   * one line's value and applies it to every selection rect.
   */
  ".cm-line": { padding: "0 4px 0 22px", position: "relative" },
  /*
   * Header spacing lives here, next to the rule it competes with: CodeMirror's
   * generated theme matches `.cm-line` at the same specificity as a plain class
   * selector, so the same declaration in styles.css silently lost.
   *
   * It must also be padding rather than margin -- CodeMirror maps a click to a
   * document position by measuring line boxes, and a margin falls outside that
   * box, which put every click on a header onto the line below it.
   */
  /*
   * Padding-left must be identical on every line: `rectanglesForRange` reads
   * it from whichever line happens to be first in the DOM and uses that as the
   * left edge of every selection rect.
   */
  ".cm-line.sp-line--header": { paddingTop: "1.1em" },
});

export function createEditor(hooks: EditorHooks) {
  const startFocus = (view: EditorView): boolean => {
    const targets = focusTargetsIn(view.state);
    if (targets.length === 0) return false;
    hooks.onStartFocus(targets);
    return true;
  };

  const sprintpadKeymap = Prec.highest(
    keymap.of([
      { key: "Enter", run: insertTaskLine },
      { key: "Backspace", run: deleteLineHead },
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
   * §16: pasted plain lines are already tasks; this only widens markdown and
   * unicode checkboxes. Anything canonical is left to paste verbatim, so
   * in-app copy/paste stays lossless.
   */
  const pasteHandler = EditorView.domEventHandlers({
    paste(event, view) {
      const raw = event.clipboardData?.getData("text/plain");
      if (!raw) return false;
      const transformed = transformPastedText(raw);
      if (transformed === null) return false;
      event.preventDefault();
      view.dispatch(view.state.replaceSelection(transformed));
      return true;
    },
  });

  /**
   * Absorbs a `[]` typed out of habit at the head of an empty task, so it does
   * not land next to the checkbox as literal text. See markerInput.ts.
   */
  const markerInput = EditorView.inputHandler.of((view, from, to, typed) => {
    if (from !== to) return false;
    const { state } = view;
    const action = markerInputAction(
      state.doc.lineAt(from),
      from,
      typed,
      state.field(swallowedMarkerField, false) ?? null,
    );
    if (action === null) return false;

    if (action.kind === "literal") {
      view.dispatch({
        changes: { from, insert: typed },
        selection: { anchor: from + typed.length },
        effects: setSwallowedMarker.of(null),
        userEvent: "input.type",
      });
      return true;
    }

    // Show the waiting checkbox as the marker is absorbed. Without it the
    // keystroke looks like it did nothing, and the natural response is to
    // press the key again.
    view.dispatch({
      effects: [
        setSwallowedMarker.of({ pos: from, consumed: action.consumed }),
        setPendingTask.of(state.doc.lineAt(from).from),
      ],
    });
    return true;
  });

  const view = new EditorView({
    parent: hooks.parent,
    state: EditorState.create({
      doc: hooks.doc,
      extensions: [
        history(),
        /*
         * The browser sizes a native caret from the text around it, so on an
         * empty line -- where there is none -- it stretched to the full 1.75
         * line-height and sat higher than the text, reading as a cursor
         * floating between two tasks. CodeMirror draws its own instead.
         */
        drawSelection(),
        search({ top: true }),
        focusAnchorsField,
        pendingTaskField,
        swallowedMarkerField,
        markerInput,
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
        placeholder("Type a task…"),
        pasteHandler,
        baseTheme,
        themeCompartment.of(EditorView.theme({}, { dark: false })),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          hooks.onDocChange(update.state.doc.toString());
          const titles = hooks.focusSnapshot();
          if (titles === null) return;
          const anchors = reanchorTo(update.state, titles);
          if (anchors !== null) update.view.dispatch({ effects: setFocusAnchors.of(anchors) });
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

    /** Replaces the document as one undoable edit. */
    setDoc(doc: string): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        selection: { anchor: 0 },
        userEvent: "input",
      });
      view.focus();
    },

    setDark(dark: boolean): void {
      view.dispatch({
        effects: themeCompartment.reconfigure(EditorView.theme({}, { dark })),
      });
    },

    /**
     * Anchors a focus session to the given task lines, and collapses the
     * selection to the end of the last of them. Leaving a multi-line selection
     * standing would mean the next character typed replaced the whole group.
     */
    anchorTo(positions: readonly number[]): void {
      const lines = positions.map((pos) => view.state.doc.lineAt(pos));
      view.dispatch({
        effects: setFocusAnchors.of(lines.map(anchorForLine)),
        selection: { anchor: lines[lines.length - 1]?.to ?? view.state.selection.main.head },
      });
    },

    clearAnchor(): void {
      view.dispatch({ effects: setFocusAnchors.of([]) });
    },

    /**
     * Re-attaches a session restored from storage. The stored position is only
     * trusted when the line it names still holds that task; otherwise the title
     * decides, so a document edited in another tab cannot focus the wrong line.
     */
    restoreFocus(anchors: readonly number[], titles: readonly string[]): void {
      const { state } = view;
      const lines = anchors
        .map((anchor) => (anchor <= state.doc.length ? state.doc.lineAt(anchor) : null))
        .filter((line): line is NonNullable<typeof line> => {
          if (!line) return false;
          const parsed = parseLine(line.text);
          return parsed.kind === "task" && titles.includes(parsed.text.trim());
        });

      const resolved = lines.length === titles.length ? lines : resolveFocusedLines(state, titles);
      view.dispatch({ effects: setFocusAnchors.of(resolved.map(anchorForLine)) });
    },

    /** Marks lines complete and parks the cursor on the next open task (§13). */
    completeAt(positions: readonly number[]): void {
      // Back to front, so completing one line cannot shift the next.
      for (const pos of [...positions].sort((a, b) => b - a)) {
        const spec = completeLineAt(view.state, pos);
        if (spec) view.dispatch({ ...spec, userEvent: "input" });
      }
      const last = Math.max(...positions);
      const next = nextOpenTaskAfter(view.state, last);
      if (next) view.dispatch({ selection: { anchor: next.to }, scrollIntoView: true });
      view.focus();
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;
