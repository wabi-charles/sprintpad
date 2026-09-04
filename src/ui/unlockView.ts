import { trapFocus } from "./focusTrap";
import type { PadSync } from "../sync/pad";

/**
 * The prompt on arriving at a pad this device has not opened. Deliberately not
 * the pad manager: you followed a link to one list, so you are asked for one
 * password and nothing else.
 */
export function createUnlockView(parent: HTMLElement, sync: PadSync, onOpened: () => void) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-sync";
  overlay.append(box);
  parent.append(overlay);

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  let restoreFocus: (() => void) | null = null;
  let releaseTrap: (() => void) | null = null;

  function close(): void {
    overlay.hidden = true;
    releaseTrap?.();
    releaseTrap = null;
    const restore = restoreFocus;
    restoreFocus = null;
    restore?.();
  }

  function paint(): void {
    box.replaceChildren();

    const heading = document.createElement("h2");
    heading.className = "sp-sync__title";
    heading.textContent = `Pad “${sync.padId}”`;
    box.append(heading);

    const status = document.createElement("p");
    status.className = "sp-sync__status";
    const state = sync.status;
    status.textContent =
      state.kind === "error"
        ? state.detail
        : state.kind === "working"
          ? "Opening…"
          : "Enter this pad's password to open it.";
    box.append(status);

    const hint = document.createElement("p");
    hint.className = "sp-sync__hint";
    hint.textContent =
      "The password is the key, not a login — this pad is encrypted in your browser, so the " +
      "server cannot read it and nobody can reset the password for you.";
    box.append(hint);

    const row = document.createElement("label");
    row.className = "sp-sync__row";
    const caption = document.createElement("span");
    caption.textContent = "Password";
    const input = document.createElement("input");
    input.className = "sp-sync__input";
    input.type = "password";
    row.append(caption, input);
    box.append(row);

    const open = document.createElement("button");
    open.type = "button";
    open.className = "sp-btn sp-btn--primary";
    open.textContent = "Open pad";
    open.addEventListener("click", async () => {
      if (input.value === "") return;
      open.disabled = true;
      await sync.unlockWith(input.value);
      open.disabled = false;
      if (sync.isUnlocked) {
        close();
        onOpened();
      } else {
        paint();
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") open.click();
    });

    const back = document.createElement("button");
    back.type = "button";
    back.className = "sp-btn";
    back.textContent = "Use the local list";
    back.addEventListener("click", () => location.assign("/"));

    const actions = document.createElement("div");
    actions.className = "sp-sync__actions";
    actions.append(open, back);
    box.append(actions);
  }

  return {
    get isOpen(): boolean {
      return !overlay.hidden;
    },

    open(onClose: () => void): void {
      restoreFocus = onClose;
      paint();
      overlay.hidden = false;
      releaseTrap = trapFocus(box);
      box.querySelector("input")?.focus();
    },

    refresh(): void {
      if (!overlay.hidden) paint();
    },

    close,
  };
}

export type UnlockView = ReturnType<typeof createUnlockView>;
