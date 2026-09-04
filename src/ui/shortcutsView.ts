/**
 * The keymap, written down. Sprintpad is keyboard-first, so the keys are the
 * product -- they should not have to be discovered by accident.
 */

const GROUPS: Array<{ title: string; keys: Array<[string, string]> }> = [
  {
    title: "Focus",
    keys: [
      ["⌘⏎", "Start focus on the task at the cursor"],
      ["⌘⏎", "With lines selected, focus on all of them at once"],
      ["⌘D", "Complete the task at the cursor"],
    ],
  },
  {
    title: "During a session",
    keys: [
      ["⇧⌘Space", "Pause, resume, or keep working when time is up"],
      ["⇧⌘⏎", "Done — complete the focused task"],
      ["⇧⌘B", "Take a break"],
      ["⇧⌘.", "End the session"],
      ["Space / Esc", "The same, while the timer panel has focus"],
    ],
  },
  {
    title: "Writing",
    keys: [
      ["⏎", "New task"],
      ["⏎", "On an empty task, step back out one level"],
      ["Tab", "Indent"],
      ["⇧Tab", "Outdent"],
      ["⌫", "At the head of a line, unwrap a header or completed task"],
      ["#", "At the start of a line, make it a header"],
    ],
  },
  {
    title: "Moving",
    keys: [
      ["⌘↑", "Move task up"],
      ["⌘↓", "Move task down"],
      ["⌘Z", "Undo"],
      ["⇧⌘Z", "Redo"],
      ["⌘F", "Search"],
    ],
  },
  {
    title: "App",
    keys: [
      ["⌘K", "Command palette"],
      ["⌘/", "This list"],
    ],
  },
];

export function createShortcutsView(parent: HTMLElement) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-shortcuts";
  box.tabIndex = -1;

  for (const group of GROUPS) {
    const heading = document.createElement("h2");
    heading.className = "sp-shortcuts__title";
    heading.textContent = group.title;
    box.append(heading);

    const list = document.createElement("dl");
    list.className = "sp-shortcuts__list";
    for (const [key, description] of group.keys) {
      const term = document.createElement("dt");
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      term.append(kbd);

      const detail = document.createElement("dd");
      detail.textContent = description;
      list.append(term, detail);
    }
    box.append(list);
  }

  overlay.append(box);
  parent.append(overlay);

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  let restoreFocus: (() => void) | null = null;

  function close(): void {
    overlay.hidden = true;
    const restore = restoreFocus;
    restoreFocus = null;
    restore?.();
  }

  return {
    get isOpen(): boolean {
      return !overlay.hidden;
    },

    open(onClose: () => void): void {
      restoreFocus = onClose;
      overlay.hidden = false;
      box.focus();
    },

    close,
  };
}

export type ShortcutsView = ReturnType<typeof createShortcutsView>;
