import type { Editor } from "../doc/editor";

/**
 * Indent, outdent and reorder for devices with no keyboard.
 *
 * Sprintpad is keyboard-first, but on a phone there is no keyboard-first to be
 * — Tab and ⌘↑/⌘↓ simply cannot be pressed, and both are load-bearing here:
 * indentation is the outline and position is the priority. Shown only where
 * there is no other way to reach them, so the desktop stays as it was.
 */
const CONTROLS = [
  { label: "⇤", title: "Outdent", run: (editor: Editor) => editor.outdent() },
  { label: "⇥", title: "Indent", run: (editor: Editor) => editor.indent() },
  { label: "↑", title: "Move task up", run: (editor: Editor) => editor.moveUp() },
  { label: "↓", title: "Move task down", run: (editor: Editor) => editor.moveDown() },
] as const;

export function createTouchBar(parent: HTMLElement, editor: () => Editor): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "sp-touchbar";

  for (const control of CONTROLS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sp-touchbar__button";
    button.textContent = control.label;
    button.title = control.title;
    button.setAttribute("aria-label", control.title);
    // Swallow the press, not the tap: the editor must keep the caret (and, on a
    // phone, the on-screen keyboard) while the command runs on the click.
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => control.run(editor()));
    bar.append(button);
  }

  parent.append(bar);
  return bar;
}
