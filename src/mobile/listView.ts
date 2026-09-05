import { rowsFor, sectionsFor, openCount, type Row } from "./rows";
import {
  backspaceAt,
  deleteRowAt,
  indentAt,
  moveRowAt,
  newTaskAt,
  setTextAt,
  toggleDoneAt,
  type Applied,
} from "./ops";

/**
 * The list.
 *
 * Everything a finger can do to the document happens here: tap the circle to
 * complete, tap the text to edit it in place, swipe for focus and delete, and
 * type a whole list without the keyboard ever going down. There is no cursor
 * to aim at and no shortcut to remember, because on a phone there is neither.
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

const SWIPE_OPEN = 132;
const SWIPE_TRIGGER = 44;

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

  function commitEditing(): void {
    const field = root.querySelector<HTMLElement>(".sp-m-row__text[contenteditable]");
    if (!field || editingFrom === null) return;
    const row = rowAtFrom(editingFrom);
    if (!row) return;
    const text = (field.textContent ?? "").replace(/\n/g, " ").trim();
    if (text === row.text) return;
    hooks.change(setTextAt(hooks.doc(), row, text));
  }

  function rowAtFrom(from: number): Row | null {
    return rowsFor(hooks.doc()).find((row) => row.from === from) ?? null;
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

  // ------------------------------------------------------------- gestures ---

  /**
   * Swipe reveals actions under the row. Pointer events rather than touch so
   * the same code answers a trackpad drag, and the row only starts moving once
   * the gesture is clearly horizontal -- otherwise every scroll would snag.
   */
  function attachSwipe(item: HTMLElement, surface: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let dragging: boolean | null = null;
    let offset = 0;

    surface.addEventListener("pointerdown", (event) => {
      if (editingFrom !== null) return;
      startX = event.clientX;
      startY = event.clientY;
      dragging = null;
      offset = 0;
    });

    surface.addEventListener("pointermove", (event) => {
      if (event.buttons === 0 || editingFrom !== null) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (dragging === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        dragging = Math.abs(dx) > Math.abs(dy);
        if (dragging) surface.setPointerCapture(event.pointerId);
      }
      if (!dragging) return;

      event.preventDefault();
      offset = Math.max(-SWIPE_OPEN, Math.min(0, dx));
      surface.style.transform = `translateX(${offset}px)`;
    });

    const settle = (): void => {
      if (!dragging) return;
      dragging = null;
      const open = offset < -SWIPE_TRIGGER;
      surface.style.transform = open ? `translateX(${-SWIPE_OPEN}px)` : "";
      item.classList.toggle("is-open", open);
      offset = open ? -SWIPE_OPEN : 0;
    };

    surface.addEventListener("pointerup", settle);
    surface.addEventListener("pointercancel", settle);
  }

  // --------------------------------------------------------------- render ---

  function renderRow(row: Row, focusedPositions: readonly number[]): HTMLElement {
    const item = document.createElement("li");
    item.className = "sp-m-row";
    item.dataset.depth = String(Math.min(row.depth, 4));
    if (row.done) item.classList.add("is-done");
    if (focusedPositions.some((at) => at >= row.from && at <= row.to)) {
      item.classList.add("is-focused");
    }

    // The actions sit underneath and are revealed by the swipe.
    const actions = document.createElement("div");
    actions.className = "sp-m-row__actions";
    actions.append(
      actionButton("Focus", "focus", () => {
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
        // close the row on every indent. A tap on the accessory bar is not a
        // real blur either -- the bar prevents the pointer default, so focus
        // never actually leaves.
        if (rendering) return;
        if (editingFrom === row.from) stopEditing();
      });
    } else {
      text.addEventListener("click", () => edit(row.from, caretFromClick(text)));
    }

    surface.append(circle, text);
    item.append(actions, surface);
    attachSwipe(item, surface);
    return item;
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
    const applied = backspaceAt(hooks.doc(), current.from + current.raw.length - current.text.length);
    editingFrom = applied.caret;
    caretOffset = 0;
    hooks.change(applied);
  }

  function render(): void {
    rendering = true;
    const doc = hooks.doc();
    const rows = rowsFor(doc);
    const focusedPositions = hooks.focused();
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
      for (const row of section.rows) list.append(renderRow(row, focusedPositions));
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

    /** Indent, outdent and move act on whatever is being edited. */
    indent(delta: 1 | -1): void {
      if (editingFrom === null) return;
      commitEditing();
      const row = rowAtFrom(editingFrom);
      if (!row) return;
      const applied = indentAt(hooks.doc(), row.from + row.raw.length, delta);
      const moved = rowsFor(applied.doc).find((r) => r.index === row.index);
      editingFrom = moved?.from ?? applied.caret;
      caretOffset = row.text.length;
      hooks.change(applied);
    },

    move(delta: 1 | -1): void {
      if (editingFrom === null) return;
      commitEditing();
      const row = rowAtFrom(editingFrom);
      if (!row) return;
      const applied = moveRowAt(hooks.doc(), row.index, delta);
      editingFrom = applied.caret;
      caretOffset = row.text.length;
      hooks.change(applied);
    },

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
