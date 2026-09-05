import { trapFocus } from "../ui/focusTrap";

/**
 * Everything that is not the list.
 *
 * A phone has no command palette and no menu bar, so the settings, the pads,
 * the version history and the raw text all live behind one button in the
 * corner -- a sheet that slides up from the bottom, where a thumb already is.
 */

export interface MenuItem {
  label: string;
  detail?: string;
  run(): void;
}

export function createMenuSheet(parent: HTMLElement, items: () => MenuItem[]) {
  const overlay = document.createElement("div");
  overlay.className = "sp-m-sheet";
  overlay.hidden = true;

  const panel = document.createElement("div");
  panel.className = "sp-m-sheet__panel";
  overlay.append(panel);
  parent.append(overlay);

  let releaseTrap: (() => void) | null = null;

  function close(): void {
    overlay.hidden = true;
    releaseTrap?.();
    releaseTrap = null;
  }

  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) close();
  });

  return {
    get isOpen(): boolean {
      return !overlay.hidden;
    },

    close,

    open(): void {
      panel.replaceChildren();

      for (const item of items()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sp-m-sheet__item";

        const label = document.createElement("span");
        label.textContent = item.label;
        button.append(label);

        if (item.detail !== undefined) {
          const detail = document.createElement("span");
          detail.className = "sp-m-sheet__detail";
          detail.textContent = item.detail;
          button.append(detail);
        }

        button.addEventListener("click", () => {
          close();
          item.run();
        });
        panel.append(button);
      }

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "sp-m-sheet__cancel";
      cancel.textContent = "Close";
      cancel.addEventListener("click", close);
      panel.append(cancel);

      overlay.hidden = false;
      releaseTrap = trapFocus(panel);
      panel.querySelector("button")?.focus();
    },
  };
}

export type MenuSheet = ReturnType<typeof createMenuSheet>;

/**
 * The document as text, which is what it has been all along.
 *
 * Gestures cannot express everything, and the one thing Sprintpad has always
 * been able to do is swallow a pasted list. This keeps that on a phone, and
 * gives an escape hatch when a row will not do what you want.
 */
export function createTextView(
  parent: HTMLElement,
  read: () => string,
  write: (doc: string) => void,
) {
  const overlay = document.createElement("div");
  overlay.className = "sp-m-text";
  overlay.hidden = true;

  const bar = document.createElement("div");
  bar.className = "sp-m-text__bar";
  const title = document.createElement("span");
  title.textContent = "Edit as text";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "sp-m-btn sp-m-btn--primary";
  done.textContent = "Done";

  const area = document.createElement("textarea");
  area.className = "sp-m-text__area";
  area.spellcheck = false;
  area.autocapitalize = "off";
  area.autocomplete = "off";

  bar.append(title, done);
  overlay.append(bar, area);
  parent.append(overlay);

  let releaseTrap: (() => void) | null = null;

  function close(): void {
    // Written on the way out rather than on every keystroke: a half-typed
    // line is not a document anyone wants synced to their other devices.
    write(area.value);
    overlay.hidden = true;
    releaseTrap?.();
    releaseTrap = null;
  }

  done.addEventListener("click", close);

  return {
    get isOpen(): boolean {
      return !overlay.hidden;
    },

    close,

    open(): void {
      area.value = read();
      overlay.hidden = false;
      releaseTrap = trapFocus(overlay);
      area.focus();
    },
  };
}

export type TextView = ReturnType<typeof createTextView>;
