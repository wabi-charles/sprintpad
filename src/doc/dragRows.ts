import { RangeSetBuilder, StateEffect, StateField, type Extension, type Line } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { blockOf, moveEdit, type Block } from "./blocks";
import { parseLine } from "./grammar";

/**
 * Dragging rows with the mouse, the way Notion and Slack canvases do it.
 *
 * Hover a row and a grip appears in the margin beside it. Pull the grip and the
 * row lifts -- along with everything indented under it -- while a line shows
 * where it will land. Let go and it moves there, as one edit you can undo.
 *
 * The grip and the drop line live outside the editor, fixed to the page. The
 * text column scrolls inside a box that clips anything beyond its edges, and
 * the margin is exactly where a grip belongs, so they float above it instead
 * and are positioned from the line under the pointer.
 *
 * ⌘↑ and ⌘↓ remain the keyboard's way to move a row; the grip is for the mouse.
 */

/** Lines being carried, so they can be drawn as lifted. */
const setLifted = StateEffect.define<Block | null>();

const lifted = Decoration.line({ class: "sp-line--lifted" });

const liftedField = StateField.define<Block | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLifted)) return effect.value;
    // The text changed under a drag -- another device's edit arriving, say --
    // and the range no longer means what it did. The drag is abandoned too.
    return tr.docChanged ? null : value;
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state): DecorationSet => {
      const block = state.field(field);
      if (!block) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      for (let n = block.start + 1; n <= block.end + 1 && n <= state.doc.lines; n++) {
        const line = state.doc.line(n);
        builder.add(line.from, line.from, lifted);
      }
      return builder.finish();
    }),
});

/** How close to the top or bottom edge a drag has to come before the list scrolls. */
const EDGE = 56;
const GRIP_WIDTH = 20;
const GRIP_HEIGHT = 24;

interface Drag {
  block: Block;
  pointerId: number;
  /** Last pointer position, kept so scrolling can re-aim without a move. */
  y: number;
  /** Line index the block would be dropped before, or null for nowhere. */
  before: number | null;
  frame: number;
}

class RowDragger {
  private readonly grip: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  /** One-based line the grip is beside. */
  private hovered: number | null = null;
  private drag: Drag | null = null;

  constructor(private readonly view: EditorView) {
    const doc = view.dom.ownerDocument;

    this.grip = doc.createElement("div");
    this.grip.className = "sp-grip";
    this.grip.title = "Drag to move";
    // The keyboard has ⌘↑ and ⌘↓; this is a mouse affordance and nothing else.
    this.grip.setAttribute("aria-hidden", "true");
    this.grip.hidden = true;

    this.marker = doc.createElement("div");
    this.marker.className = "sp-drop";
    this.marker.hidden = true;

    doc.body.append(this.grip, this.marker);

    this.grip.addEventListener("pointerdown", this.onGripDown);
    this.grip.addEventListener("pointermove", this.onGripMove);
    this.grip.addEventListener("pointerup", this.onGripUp);
    this.grip.addEventListener("pointercancel", this.cancel);
    this.grip.addEventListener("lostpointercapture", this.cancel);
    this.grip.addEventListener("mouseleave", this.onGripLeave);
    view.dom.addEventListener("mousemove", this.onHover);
    view.dom.addEventListener("mouseleave", this.onLeave);
    // Typing hides it, as it does in Notion: a grip hovering beside the line
    // being written is noise.
    view.dom.addEventListener("keydown", this.hideGrip);
    view.scrollDOM.addEventListener("scroll", this.onScroll);
  }

  update(update: ViewUpdate): void {
    // No dispatching from here: CodeMirror is mid-update. The lifted range
    // clears itself on any edit, so only the drag's own state needs letting go.
    if (this.drag && update.docChanged) this.release();
    if (update.docChanged || update.geometryChanged) this.hideGrip();
  }

  destroy(): void {
    this.release();
    this.view.dom.removeEventListener("mousemove", this.onHover);
    this.view.dom.removeEventListener("mouseleave", this.onLeave);
    this.view.dom.removeEventListener("keydown", this.hideGrip);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.grip.remove();
    this.marker.remove();
  }

  // ------------------------------------------------------------- hovering ---

  /** The line whose box the pointer is over, or null outside the text. */
  private lineAt(clientY: number, clamp: boolean): Line | null {
    const height = clientY - this.view.documentTop;
    const block = this.view.lineBlockAtHeight(height);
    if (!clamp && (height < block.top || height > block.bottom)) return null;
    return this.view.state.doc.lineAt(block.from);
  }

  private onHover = (event: MouseEvent): void => {
    if (this.drag) return;
    const line = this.lineAt(event.clientY, false);
    if (!line || parseLine(line.text).kind === "blank") {
      this.hideGrip();
      return;
    }
    this.hovered = line.number;
    this.placeGrip(line);
  };

  /** Beside the first row of text -- not the top of a header's spacing. */
  private placeGrip(line: Line): void {
    const parsed = parseLine(line.text);
    const textStart = line.from + Math.max(0, parsed.markerTo);
    const rect = this.view.coordsAtPos(textStart, 1) ?? this.view.coordsAtPos(line.from, 1);
    if (!rect) {
      this.hideGrip();
      return;
    }
    const content = this.view.contentDOM.getBoundingClientRect();
    const middle = (rect.top + rect.bottom) / 2;
    this.grip.style.top = `${Math.round(middle - GRIP_HEIGHT / 2)}px`;
    // Flush against the text column, so the pointer can cross onto it without
    // ever leaving one or the other.
    this.grip.style.left = `${Math.max(2, Math.round(content.left - GRIP_WIDTH))}px`;
    this.grip.hidden = false;
  }

  private hideGrip = (): void => {
    if (this.drag) return;
    this.grip.hidden = true;
    this.hovered = null;
  };

  private onLeave = (event: MouseEvent): void => {
    // Leaving the text for the grip is the one way out that keeps it.
    if (this.drag || event.relatedTarget === this.grip) return;
    this.hideGrip();
  };

  private onGripLeave = (event: MouseEvent): void => {
    if (this.drag) return;
    const to = event.relatedTarget;
    if (to instanceof Node && this.view.dom.contains(to)) return;
    this.hideGrip();
  };

  private onScroll = (): void => {
    if (this.drag) this.track();
    else this.hideGrip();
  };

  // ------------------------------------------------------------- dragging ---

  private onGripDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.hovered === null) return;
    // No text selection, no focus change: the editor keeps its caret.
    event.preventDefault();

    const lines = this.view.state.doc.toString().split("\n");
    const block = blockOf(lines, this.hovered - 1);
    if (!block) return;

    // Best-effort, as on the phone: without it the drag still works while the
    // pointer stays over the grip, and nothing should be able to break a drag.
    try {
      this.grip.setPointerCapture(event.pointerId);
    } catch {
      // No such pointer to hold.
    }
    this.drag = { block, pointerId: event.pointerId, y: event.clientY, before: null, frame: 0 };
    this.grip.classList.add("is-active");
    this.view.dom.ownerDocument.body.classList.add("sp-dragging-rows");
    this.view.dom.ownerDocument.addEventListener("keydown", this.onKey, true);
    this.view.dispatch({ effects: setLifted.of(block) });
    this.drag.frame = requestAnimationFrame(this.scrollStep);
    this.track();
  };

  private onGripMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag.y = event.clientY;
    this.track();
  };

  private onGripUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const { block, before } = this.drag;
    this.finish();
    if (before === null) return;

    const edit = moveEdit(this.view.state.doc.toString(), block, before);
    if (!edit) return;
    this.view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.head },
      userEvent: "move.line",
      scrollIntoView: true,
    });
    this.view.focus();
  };

  private onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };

  private cancel = (): void => {
    if (this.drag) this.finish();
  };

  /** Where the block would land: the gap nearest the pointer, outside itself. */
  private dropTarget(y: number): number | null {
    if (!this.drag) return null;
    const line = this.lineAt(y, true);
    if (!line) return null;
    const box = this.view.lineBlockAt(line.from);
    const middle = this.view.documentTop + box.top + box.height / 2;
    const before = y < middle ? line.number - 1 : line.number;
    const { start, end } = this.drag.block;
    return before >= start && before <= end + 1 ? null : before;
  }

  private track(): void {
    if (!this.drag) return;
    const before = this.dropTarget(this.drag.y);
    this.drag.before = before;
    if (before === null) {
      this.marker.hidden = true;
      return;
    }

    const doc = this.view.state.doc;
    const edge =
      before < doc.lines
        ? this.view.lineBlockAt(doc.line(before + 1).from).top
        : this.view.lineBlockAt(doc.line(doc.lines).from).bottom;
    const y = this.view.documentTop + edge;

    const scroller = this.view.scrollDOM.getBoundingClientRect();
    if (y < scroller.top || y > scroller.bottom) {
      this.marker.hidden = true;
      return;
    }
    const content = this.view.contentDOM.getBoundingClientRect();
    this.marker.style.top = `${Math.round(y - 1)}px`;
    this.marker.style.left = `${Math.round(content.left + 18)}px`;
    this.marker.style.width = `${Math.max(0, Math.round(content.width - 22))}px`;
    this.marker.hidden = false;
  }

  /** Near an edge, the list scrolls under the drag, faster the closer it gets. */
  private scrollStep = (): void => {
    if (!this.drag) return;
    const scroller = this.view.scrollDOM;
    const rect = scroller.getBoundingClientRect();
    const y = this.drag.y;

    let step = 0;
    if (y < rect.top + EDGE) step = -Math.min(24, Math.ceil((rect.top + EDGE - y) / 5));
    else if (y > rect.bottom - EDGE) step = Math.min(24, Math.ceil((y - rect.bottom + EDGE) / 5));

    if (step !== 0) {
      const was = scroller.scrollTop;
      scroller.scrollTop += step;
      if (scroller.scrollTop !== was) this.track();
    }
    this.drag.frame = requestAnimationFrame(this.scrollStep);
  };

  /** End the drag and clear the lifted lines. */
  private finish(): void {
    this.release();
    this.view.dispatch({ effects: setLifted.of(null) });
  }

  /** End the drag without touching the editor -- safe from inside an update. */
  private release(): void {
    if (!this.drag) return;
    cancelAnimationFrame(this.drag.frame);
    const { pointerId } = this.drag;
    this.drag = null;
    try {
      if (this.grip.hasPointerCapture(pointerId)) this.grip.releasePointerCapture(pointerId);
    } catch {
      // Already gone.
    }
    this.grip.classList.remove("is-active");
    this.view.dom.ownerDocument.body.classList.remove("sp-dragging-rows");
    this.view.dom.ownerDocument.removeEventListener("keydown", this.onKey, true);
    this.marker.hidden = true;
    this.grip.hidden = true;
    this.hovered = null;
  }
}

export function dragRows(): Extension {
  return [liftedField, ViewPlugin.fromClass(RowDragger)];
}
