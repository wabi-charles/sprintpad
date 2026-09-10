import { trapFocus } from "./focusTrap";

/**
 * One line, for the thought that arrived at the wrong moment.
 *
 * Deliberately the smallest thing that could work: no task list, no section
 * picker, no due date. Type it, press Enter, carry on. Anything more to decide
 * would make it cheaper to keep holding the thought in your head, which is the
 * thing this exists to stop.
 *
 * The confirmation matters as much as the field. You are not looking at the
 * document -- you are working -- so it has to say the thought landed without
 * making you go and check.
 */
export function createParkView(parent: HTMLElement, onPark: (text: string) => void) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-park";

  const label = document.createElement("label");
  label.className = "sp-park__label";
  label.textContent = "Park a thought";

  const input = document.createElement("input");
  input.className = "sp-park__input";
  input.type = "text";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Park a thought");

  const hint = document.createElement("p");
  hint.className = "sp-park__hint";
  hint.textContent = "Goes to the bottom of the list. Your place is kept.";

  label.append(input);
  box.append(label, hint);
  overlay.append(box);
  parent.append(overlay);

  const toast = document.createElement("div");
  toast.className = "sp-parked";
  toast.hidden = true;
  parent.append(toast);

  let restoreFocus: (() => void) | null = null;
  let releaseTrap: (() => void) | null = null;
  let hideToast = 0;

  function close(): void {
    overlay.hidden = true;
    releaseTrap?.();
    releaseTrap = null;
    const restore = restoreFocus;
    restoreFocus = null;
    restore?.();
  }

  function confirm(text: string): void {
    toast.textContent = `Parked “${text}”`;
    toast.hidden = false;
    window.clearTimeout(hideToast);
    hideToast = window.setTimeout(() => {
      toast.hidden = true;
    }, 2400);
  }

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  input.addEventListener("keydown", (event) => {
    // The session's own keys are global; typing a thought must not trigger them.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Enter") return;

    event.preventDefault();
    const text = input.value.trim();
    close();
    if (text === "") return;
    onPark(text);
    confirm(text);
  });

  return {
    get isOpen(): boolean {
      return !overlay.hidden;
    },

    close,

    open(onClose: () => void): void {
      restoreFocus = onClose;
      input.value = "";
      overlay.hidden = false;
      releaseTrap = trapFocus(box);
      input.focus();
    },
  };
}

export type ParkView = ReturnType<typeof createParkView>;
