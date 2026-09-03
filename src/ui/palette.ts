/**
 * ⌘K. A filterable list of everything you can do without the mouse, which is
 * also where the less-common actions live instead of accumulating chrome.
 */

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run(): void;
}

function score(command: PaletteCommand, query: string): number {
  if (query === "") return 1;
  const label = command.label.toLowerCase();
  const index = label.indexOf(query);
  if (index === 0) return 3;
  if (index > 0) return 2;
  // Fall back to subsequence matching so "tdm" finds "Toggle dark mode".
  let cursor = 0;
  for (const char of query) {
    cursor = label.indexOf(char, cursor) + 1;
    if (cursor === 0) return 0;
  }
  return 1;
}

export function createPalette(parent: HTMLElement, getCommands: () => PaletteCommand[]) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-palette";

  const input = document.createElement("input");
  input.className = "sp-palette__input";
  input.type = "text";
  input.placeholder = "Type a command…";
  input.setAttribute("aria-label", "Command palette");

  const list = document.createElement("ul");
  list.className = "sp-palette__list";

  box.append(input, list);
  overlay.append(box);
  parent.append(overlay);

  let matches: PaletteCommand[] = [];
  let active = 0;
  let restoreFocus: (() => void) | null = null;

  function paint(): void {
    const query = input.value.trim().toLowerCase();
    matches = getCommands()
      .map((command) => ({ command, rank: score(command, query) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .map((entry) => entry.command);

    active = Math.min(active, Math.max(0, matches.length - 1));

    list.replaceChildren(
      ...matches.map((command, index) => {
        const item = document.createElement("li");
        item.className = `sp-palette__item${index === active ? " is-active" : ""}`;

        const label = document.createElement("span");
        label.textContent = command.label;
        item.append(label);

        if (command.hint) {
          const hint = document.createElement("kbd");
          hint.textContent = command.hint;
          item.append(hint);
        }

        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          choose(index);
        });
        return item;
      }),
    );

    if (matches.length === 0) {
      const empty = document.createElement("li");
      empty.className = "sp-palette__empty";
      empty.textContent = "No matching command";
      list.append(empty);
    }
  }

  function close(): void {
    overlay.hidden = true;
    const restore = restoreFocus;
    restoreFocus = null;
    restore?.();
  }

  function choose(index: number): void {
    const command = matches[index];
    close();
    command?.run();
  }

  input.addEventListener("input", () => {
    active = 0;
    paint();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      active = matches.length === 0 ? 0 : (active + 1) % matches.length;
      paint();
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      active = matches.length === 0 ? 0 : (active - 1 + matches.length) % matches.length;
      paint();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  return {
    get isOpen(): boolean {
      return !overlay.hidden;
    },

    open(onClose: () => void): void {
      restoreFocus = onClose;
      overlay.hidden = false;
      input.value = "";
      active = 0;
      paint();
      input.focus();
    },

    close,
  };
}

export type Palette = ReturnType<typeof createPalette>;
