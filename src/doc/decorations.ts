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

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const focused = anchoredLine(view.state);

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const parsed = parseLine(line.text);

      // Line decorations sort ahead of the replacement at the same position.
      if (parsed.kind === "task") {
        builder.add(line.from, line.from, parsed.completed ? doneLine : openLine);
      } else if (parsed.kind === "header") {
        builder.add(line.from, line.from, headerLine);
      }
      if (focused && focused.from === line.from) {
        builder.add(line.from, line.from, focusedLine);
      }
      if (parsed.kind === "task") {
        builder.add(
          line.from + parsed.markerFrom,
          line.from + parsed.markerTo,
          Decoration.replace({ widget: new CheckboxWidget(parsed.completed) }),
        );
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
        if (update.docChanged || update.viewportChanged || focusChanged) {
          this.decorations = build(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        mousedown(event, view) {
          const target = event.target as HTMLElement | null;
          if (!target?.classList.contains("sp-check")) return false;
          const pos = view.posAtDOM(target);
          event.preventDefault();
          onToggle(view, pos);
          return true;
        },
      },
    },
  );
}
