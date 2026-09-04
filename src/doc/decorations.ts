import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { anchoredLine, focusAnchorField } from "./focusField";
import { parseLine } from "./grammar";
import { pendingTaskField, pendingTaskLine } from "./pendingTask";

/**
 * All of Sprintpad's visual richness is painted over plain text: the document
 * still reads `[] Pay taxes`, so copy, paste, export and undo all behave like
 * a text editor's while the screen shows a checklist.
 */

class CheckboxWidget extends WidgetType {
  constructor(readonly completed: boolean) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.completed === this.completed;
  }

  /**
   * Styled to a net inline advance of zero (see `.sp-check`), so the box is
   * painted in the line's left padding without occupying a column. CodeMirror
   * measures a selection ending at a line start from the *right* of that
   * position (`rectanglesForRange`), so a widget with real width there gets
   * painted as selected whenever the line above it is -- the next task's
   * checkbox lighting up for no visible reason.
   */
  toDOM(): HTMLElement {
    const box = document.createElement("span");
    box.className = `sp-check${this.completed ? " sp-check--on" : ""}`;
    box.textContent = this.completed ? "☑" : "☐";
    box.setAttribute("aria-hidden", "true");
    return box;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const doneLine = Decoration.line({ class: "sp-line sp-line--done" });
const openLine = Decoration.line({ class: "sp-line sp-line--task" });
const headerLine = Decoration.line({ class: "sp-line sp-line--header" });
const focusedLine = Decoration.line({ class: "sp-line--focused" });
/**
 * Which task ⌘Enter and ⌘D will act on. Deliberately not CodeMirror's
 * `highlightActiveLine`, which follows the selection head -- selecting a whole
 * line puts that head on the *next* line and marks the wrong task.
 */
const cursorLine = Decoration.line({ class: "sp-line--cursor" });
/** Hides the `# ` that makes a header a header. */
const hideMarker = Decoration.replace({});

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const focused = anchoredLine(view.state);
  const pending = pendingTaskLine(view.state);

  // Only a real cursor points at a task; a selection speaks for itself.
  const range = view.state.selection.main;
  const atCursor =
    view.state.selection.ranges.length === 1 && range.empty
      ? view.state.doc.lineAt(range.head).from
      : null;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const parsed = parseLine(line.text);

      // An empty line that Enter just opened is drawn as a waiting task, so
      // the list behaves like a bullet list without marking up the text.
      const waiting = parsed.kind === "blank" && pending === line.from;

      // Line decorations sort ahead of the replacement at the same position.
      if (parsed.kind === "task" || waiting) {
        builder.add(line.from, line.from, parsed.completed ? doneLine : openLine);
      } else if (parsed.kind === "header") {
        builder.add(line.from, line.from, headerLine);
      }
      if (atCursor === line.from) {
        builder.add(line.from, line.from, cursorLine);
      }
      if (focused && focused.from === line.from) {
        builder.add(line.from, line.from, focusedLine);
      }
      if (waiting) {
        builder.add(line.to, line.to, Decoration.widget({ widget: new CheckboxWidget(false), side: -1 }));
      } else if (parsed.kind === "task") {
        const widget = new CheckboxWidget(parsed.completed);
        // An open task carries no marker text, so the box is inserted rather
        // than substituted -- which is the whole point of the bare-line form.
        builder.add(
          line.from + parsed.markerFrom,
          line.from + parsed.markerTo,
          parsed.markerFrom === parsed.markerTo
            // `side: 1` keeps the box on the far side of the line start, so a
            // selection that ends there -- any line selection, which takes the
            // trailing newline with it -- stops before the next line's box.
            ? Decoration.widget({ widget, side: 1 })
            : Decoration.replace({ widget }),
        );
      } else if (parsed.kind === "header") {
        builder.add(line.from + parsed.markerFrom, line.from + parsed.markerTo, hideMarker);
      }

      pos = line.to + 1;
    }
  }

  return builder.finish();
}

/**
 * `onToggle` is injected rather than imported so this module stays unaware of
 * how completion is dispatched.
 */
export function sprintpadDecorations(onToggle: (view: EditorView, pos: number) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view);
      }

      update(update: ViewUpdate) {
        const focusChanged =
          update.startState.field(focusAnchorField, false) !==
          update.state.field(focusAnchorField, false);
        const pendingChanged =
          update.startState.field(pendingTaskField, false) !==
          update.state.field(pendingTaskField, false);
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          focusChanged ||
          pendingChanged
        ) {
          this.decorations = build(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        mousedown(event, view) {
          // The glyph is nested inside the zero-width widget, so match either.
          const box = (event.target as HTMLElement | null)?.closest(".sp-check");
          if (!box) return false;
          const pos = view.posAtDOM(box);
          event.preventDefault();
          onToggle(view, pos);
          return true;
        },
      },
    },
  );
}
