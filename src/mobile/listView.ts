import { rowsFor, sectionsFor, openCount, type Row } from "./rows";
import {
  backspaceAt,
  blockAt,
  deleteRowAt,
  moveBlockTo,
  newTaskAt,
  setTextAt,
  shiftBlockDepth,
  toggleDoneAt,
  type Applied,
} from "./ops";

/**
 * The list.
 *
 * Everything a finger can do to the document happens here: tap the circle to
 * complete, tap the text to edit it in place, swipe for focus and delete, and
 * press and hold to pick a task up and put it somewhere else. There is no
 * cursor to aim at and no shortcut to remember, because on a phone there is
 * neither -- and no arrow buttons either, because dragging the thing you are
 * looking at is what a touch screen is for.
 */

export interface ListHooks {
  doc(): string;
  /** Apply an edit to the document and redraw. */
  change(applied: Applied): void;
  startFocus(row: Row): void;
  /** The task positions a running session is on, so they can be marked. */
  focused(): readonly number[];
  select(from: number | null): void;
}

/** How far a row slides to show its actions. */
const SWIPE_OPEN = 132;
const SWIPE_TRIGGER = 44;
/** Long enough not to fire while scrolling, short enough not to feel stuck. */
const HOLD_MS = 300;
/** Sideways travel that nests a task one level deeper. */
const NEST_STEP = 38;
/** Movement that ends the argument about which gesture this is. */
const SLOP = 8;

interface Gesture {
  kind: "pending" | "swipe" | "drag";
  pointerId: number;
  /** Offset of the row the gesture started on. */
  from: number;
  /** Line index of the dragged block's head, which moves as it is dragged. */
  index: number;
  startX: number;
  startY: number;
  /** Where the last nesting step was taken from. */
  nestFrom: number;
  offset: number;
  timer: number;
}

export function createListView(parent: HTMLElement, hooks: ListHooks) {
  const root = document.createElement("main");
  root.className = "sp-m-list";
  parent.append(root);

  /** The line being edited, by character offset, or null when nothing is. */
  let editingFrom: number | null = null;
  /** Where in the text the caret should land when editing opens. */
  let caretOffset: number | null = null;
  /** True while the list is being rebuilt, when blur means nothing. */
  let rendering = false;
  let gesture: Gesture | null = null;
  /**
   * A drag or a swipe still ends with a click on the row it started from, and
   * a task should not open for editing -- or get ticked off -- because it was
   * moved. Only a tap that never became a gesture counts.
   */
  let swallowClick = false;

  // -------------------------------------------------------------- editing ---

  function rowAtFrom(from: number): Row | null {
    return rowsFor(hooks.doc()).find((row) => row.from === from) ?? null;
  }

  function commitEditing(): void {
    const field = root.querySelector<HTMLElement>(".sp-m-row__text[contenteditable]");
    if (!field || editingFrom === null) return;
    const row = rowAtFrom(editingFrom);
    if (!row) return;
    const text = (field.textContent ?? "").replace(/\n/g, " ").trim();
    if (text === row.text) return;
    hooks.change(setTextAt(hooks.doc(), row, text));
  }

  function stopEditing(): void {
    commitEditing();
    editingFrom = null;
    caretOffset = null;
    render();
  }

  /** Open a row for editing, with the caret at `offset` characters in. */
  function edit(from: number, offset?: number): void {
    if (editingFrom !== null && editingFrom !== from) commitEditing();
    editingFrom = from;
    caretOffset = offset ?? null;
    hooks.select(from);
    render();
  }

  function onEditKey(event: KeyboardEvent, row: Row): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEditing();
      const current = rowAtFrom(row.from);
      if (!current) return;
      // Enter from the end of the line: a new task below, keyboard still up.
      const applied = newTaskAt(hooks.doc(), current.to);
      editingFrom = applied.caret;
      caretOffset = 0;
      hooks.change(applied);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      stopEditing();
      return;
    }

    if (event.key !== "Backspace") return;
    const selection = document.getSelection();
    const atStart = selection?.isCollapsed && selection.anchorOffset === 0;
    if (!atStart) return;

    event.preventDefault();
    const current = rowAtFrom(row.from);
    if (!current) return;

    // An empty row goes away; a row with text sheds its marker or its indent
    // first, exactly as backspace does with a keyboard.
    if (current.text === "" && current.depth === 0) {
      const applied = deleteRowAt(hooks.doc(), current.index);
      editingFrom = null;
      hooks.change(applied);
      return;
    }
    const applied = backspaceAt(
      hooks.doc(),
      current.from + current.raw.length - current.text.length,
    );
    editingFrom = applied.caret;
    caretOffset = 0;
    hooks.change(applied);
  }

  // ------------------------------------------------------------- gestures ---

  /** Capture is best-effort: the pointer may already be gone. */
  function capture(pointerId: number, want: boolean): void {
    try {
      if (want) root.setPointerCapture(pointerId);
      else root.releasePointerCapture(pointerId);
    } catch {
      // Nothing to hold on to, which is not a reason to abandon the gesture.
    }
  }

  function surfaceFor(from: number): HTMLElement | null {
    return root.querySelector(`.sp-m-row[data-from="${from}"] .sp-m-row__surface`);
  }

  function closeSwipe(): void {
    for (const item of root.querySelectorAll<HTMLElement>(".sp-m-row.is-open")) {
      item.classList.remove("is-open");
      item.querySelector<HTMLElement>(".sp-m-row__surface")?.style.removeProperty("transform");
    }
  }

  /** The hold expired without the finger wandering: the task is picked up. */
  function beginDrag(): void {
    if (!gesture) return;
    gesture.kind = "drag";
    closeSwipe();
    root.classList.add("is-reordering");
    surfaceFor(gesture.from)?.style.removeProperty("transform");
    render();
  }

  function onRowPointerDown(event: PointerEvent, row: Row): void {
    if (editingFrom !== null) return;
    closeSwipe();
    gesture = {
      kind: "pending",
      pointerId: event.pointerId,
      from: row.from,
      index: row.index,
      startX: event.clientX,
      startY: event.clientY,
      nestFrom: event.clientX,
      offset: 0,
      timer: window.setTimeout(beginDrag, HOLD_MS),
    };
    // Captured on the list, not the row: a drag redraws the rows out from
    // under itself, and a capture on a removed element goes with it.
    capture(event.pointerId, true);
  }

  /** Which line the block should land before, given where the finger is. */
  function dropTarget(y: number): number | null {
    const under = document
      .elementFromPoint(root.getBoundingClientRect().left + 24, y)
      ?.closest<HTMLElement>(".sp-m-row");
    if (!under) return null;

    const index = Number(under.dataset.index);
    if (Number.isNaN(index)) return null;

    const box = under.getBoundingClientRect();
    return y < box.top + box.height / 2 ? index : index + 1;
  }

  function onDragMove(event: PointerEvent): void {
    if (!gesture) return;
    event.preventDefault();

    // Sideways is nesting, one level per step, so the two axes of one drag do
    // not fight each other.
    const sideways = event.clientX - gesture.nestFrom;
    if (Math.abs(sideways) >= NEST_STEP) {
      gesture.nestFrom = event.clientX;
      const applied = shiftBlockDepth(hooks.doc(), gesture.index, sideways > 0 ? 1 : -1);
      if (applied.doc !== hooks.doc()) {
        hooks.change(applied);
        return;
      }
    }

    const target = dropTarget(event.clientY);
    if (target === null) return;

    const block = blockAt(rowsFor(hooks.doc()), gesture.index);
    if (block.length === 0) return;
    const start = block[0]!.index;
    const count = block[block.length - 1]!.index - start + 1;
    if (target >= start && target <= start + count) return;

    const applied = moveBlockTo(hooks.doc(), gesture.index, target);
    if (applied.doc === hooks.doc()) return;
    gesture.index = target > start ? target - count : target;
    hooks.change(applied);
  }

  root.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    if (gesture.kind === "drag") {
      onDragMove(event);
      return;
    }

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (gesture.kind === "pending") {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      window.clearTimeout(gesture.timer);
      // Moving before the hold expires means this was a swipe or a scroll and
      // never a drag -- picking a task up has to be deliberate.
      if (Math.abs(dy) > Math.abs(dx)) {
        capture(gesture.pointerId, false);
        gesture = null;
        return;
      }
      gesture.kind = "swipe";
    }

    event.preventDefault();
    gesture.offset = Math.max(-SWIPE_OPEN, Math.min(0, dx));
    const surface = surfaceFor(gesture.from);
    if (surface) surface.style.transform = `translateX(${gesture.offset}px)`;
  });

  function endGesture(): void {
    if (!gesture) return;
    window.clearTimeout(gesture.timer);

    if (gesture.kind === "swipe") {
      const open = gesture.offset < -SWIPE_TRIGGER;
      const surface = surfaceFor(gesture.from);
      if (surface) surface.style.transform = open ? `translateX(${-SWIPE_OPEN}px)` : "";
      surface?.closest(".sp-m-row")?.classList.toggle("is-open", open);
    }

    const wasDrag = gesture.kind === "drag";
    if (gesture.kind !== "pending") {
      swallowClick = true;
      window.setTimeout(() => (swallowClick = false), 350);
    }
    capture(gesture.pointerId, false);
    gesture = null;
    root.classList.remove("is-reordering");
    if (wasDrag) render();
  }

  root.addEventListener("pointerup", endGesture);
  root.addEventListener("pointercancel", endGesture);

  // --------------------------------------------------------------- render ---

  function renderRow(row: Row, focusedPositions: readonly number[], lifted: boolean): HTMLElement {
    const item = document.createElement("li");
    item.className = "sp-m-row";
    item.dataset.depth = String(Math.min(row.depth, 4));
    item.dataset.from = String(row.from);
    item.dataset.index = String(row.index);
    if (row.done) item.classList.add("is-done");
    if (lifted) item.classList.add("is-dragging");
    if (focusedPositions.some((at) => at >= row.from && at <= row.to)) {
      item.classList.add("is-focused");
    }

    // The actions sit underneath and are revealed by the swipe.
    const actions = document.createElement("div");
    actions.className = "sp-m-row__actions";
    actions.append(
      actionButton("Focus", "focus", () => {
        closeSwipe();
        hooks.startFocus(row);
        render();
      }),
      actionButton("Delete", "delete", () => {
        hooks.change(deleteRowAt(hooks.doc(), row.index));
      }),
    );

    const surface = document.createElement("div");
    surface.className = "sp-m-row__surface";

    const circle = document.createElement("button");
    circle.type = "button";
    circle.className = "sp-m-row__check";
    circle.setAttribute("aria-label", row.done ? "Mark as not done" : "Mark as done");
    circle.setAttribute("aria-pressed", String(row.done));
    circle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (consumedByGesture()) return;
      hooks.change(toggleDoneAt(hooks.doc(), row.from));
    });

    const text = document.createElement("div");
    text.className = "sp-m-row__text";
    text.textContent = row.text;

    if (editingFrom === row.from) {
      text.contentEditable = "true";
      text.spellcheck = true;
      text.setAttribute("enterkeyhint", "next");
      text.addEventListener("keydown", (event) => onEditKey(event, row));
      text.addEventListener("blur", () => {
        // Redrawing the list removes this node, which blurs it. That is our
        // doing, not the user's, and treating it as "finished editing" would
        // close the row on every change.
        if (rendering) return;
        if (editingFrom === row.from) stopEditing();
      });
    } else {
      text.addEventListener("click", () => {
        if (consumedByGesture()) return;
        edit(row.from, caretFromClick(text));
      });
    }

    surface.append(circle, text);
    item.append(actions, surface);
    surface.addEventListener("pointerdown", (event) => onRowPointerDown(event, row));
    return item;
  }

  /** True when this click is the tail of a gesture rather than a tap. */
  function consumedByGesture(): boolean {
    if (gesture) return true;
    if (!swallowClick) return false;
    swallowClick = false;
    return true;
  }

  function actionButton(label: string, kind: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sp-m-row__action sp-m-row__action--${kind}`;
    button.textContent = label;
    button.addEventListener("click", run);
    return button;
  }

  /** Where in the text the finger landed, so editing opens at that word. */
  function caretFromClick(node: HTMLElement): number | undefined {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return undefined;
    const range = selection.getRangeAt(0);
    return node.contains(range.startContainer) ? range.startOffset : undefined;
  }

  function render(): void {
    rendering = true;
    const doc = hooks.doc();
    const rows = rowsFor(doc);
    const focusedPositions = hooks.focused();

    // The whole block travels with the finger, so the whole block is lifted.
    const lifted =
      gesture?.kind === "drag"
        ? new Set(blockAt(rows, gesture.index).map((row) => row.from))
        : new Set<number>();

    root.replaceChildren();

    for (const section of sectionsFor(rows, editingFrom)) {
      const group = document.createElement("section");
      group.className = "sp-m-section";

      if (section.header) {
        const heading = document.createElement("h2");
        heading.className = "sp-m-section__title";
        const label = document.createElement("span");
        label.textContent = section.header.text;
        const count = document.createElement("span");
        count.className = "sp-m-section__count";
        count.textContent = String(openCount(section));
        heading.append(label, count);
        group.append(heading);
      }

      const list = document.createElement("ul");
      list.className = "sp-m-section__rows";
      for (const row of section.rows) {
        list.append(renderRow(row, focusedPositions, lifted.has(row.from)));
      }
      group.append(list);
      root.append(group);
    }

    if (rows.every((row) => row.kind === "blank")) {
      const empty = document.createElement("p");
      empty.className = "sp-m-empty";
      empty.textContent = "Nothing here yet.";
      root.append(empty);
    }

    rendering = false;
    placeCaret();
  }

  /** Put the keyboard where the render just moved it. */
  function placeCaret(): void {
    if (editingFrom === null) return;
    const field = root.querySelector<HTMLElement>(".sp-m-row__text[contenteditable]");
    if (!field) return;

    field.focus();
    const selection = document.getSelection();
    if (!selection) return;

    const range = document.createRange();
    const node = field.firstChild ?? field;
    const max = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").length : 0;
    const offset = caretOffset === null ? max : Math.min(caretOffset, max);
    if (node.nodeType === Node.TEXT_NODE) range.setStart(node, offset);
    else range.setStart(field, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    caretOffset = null;
  }

  return {
    render,

    get isEditing(): boolean {
      return editingFrom !== null;
    },

    stopEditing,

    /** Add a task at the end and open it for typing. */
    addTask(): void {
      const doc = hooks.doc();
      const applied = newTaskAt(doc, doc.length);
      editingFrom = applied.caret;
      caretOffset = 0;
      hooks.change(applied);
    },
  };
}

export type ListView = ReturnType<typeof createListView>;
