import type { Settings } from "../data/storage";

/**
 * Timer settings. A panel rather than a prompt: `window.prompt` blocks the
 * page, is silently unavailable in some embedded contexts, and cannot show you
 * the current value while you change it.
 */

const MAX_MINUTES = 480;

export function createSettingsView(
  parent: HTMLElement,
  getSettings: () => Settings,
  onChange: (patch: Partial<Settings>) => void,
) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-settings";

  const heading = document.createElement("h2");
  heading.className = "sp-settings__title";
  heading.textContent = "Timer";

  const focusRow = minutesRow("Focus", (seconds) => onChange({ mode: "countdown", focusSec: seconds }));
  const breakRow = minutesRow("Break", (seconds) => onChange({ breakSec: seconds }));

  const countUp = document.createElement("label");
  countUp.className = "sp-settings__check";
  const countUpBox = document.createElement("input");
  countUpBox.type = "checkbox";
  const countUpText = document.createElement("span");
  countUpText.textContent = "Count up, with no limit";
  countUp.append(countUpBox, countUpText);
  countUpBox.addEventListener("change", () => {
    onChange({ mode: countUpBox.checked ? "countup" : "countdown" });
    paint();
  });

  box.append(heading, focusRow.root, countUp, breakRow.root);
  overlay.append(box);
  parent.append(overlay);

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  let restoreFocus: (() => void) | null = null;

  function minutesRow(label: string, commit: (seconds: number) => void) {
    const root = document.createElement("label");
    root.className = "sp-settings__row";

    const name = document.createElement("span");
    name.textContent = label;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = String(MAX_MINUTES);
    input.className = "sp-settings__input";

    const unit = document.createElement("span");
    unit.className = "sp-settings__unit";
    unit.textContent = "minutes";

    // Committing on input keeps the panel free of a save button; an
    // out-of-range value is simply not committed.
    input.addEventListener("input", () => {
      const minutes = Number(input.value);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) return;
      commit(Math.round(minutes * 60));
    });

    root.append(name, input, unit);
    return { root, input };
  }

  function paint(): void {
    const settings = getSettings();
    focusRow.input.value = String(Math.round(settings.focusSec / 60));
    breakRow.input.value = String(Math.round(settings.breakSec / 60));
    countUpBox.checked = settings.mode === "countup";
    focusRow.input.disabled = settings.mode === "countup";
    focusRow.root.classList.toggle("is-muted", settings.mode === "countup");
  }

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
      paint();
      overlay.hidden = false;
      focusRow.input.focus();
      focusRow.input.select();
    },

    close,
  };
}

export type SettingsView = ReturnType<typeof createSettingsView>;
