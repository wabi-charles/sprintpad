import { trapFocus } from "./focusTrap";
import type { PadSync } from "../sync/pad";

/**
 * The prompt for a conflict no merge could settle: the same lines rewritten
 * two different ways on two devices.
 *
 * Most disagreements never reach here -- they are merged on arrival. What is
 * left is a real choice, so it is asked plainly, and the option that keeps
 * everything is the one offered first. Sprintpad is a text editor: being shown
 * both lists and editing them together is faster than any merge UI, and it
 * cannot throw away the wrong afternoon's work.
 */
export function createConflictView(parent: HTMLElement, sync: PadSync, onSettled: () => void) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-sync";
  overlay.append(box);
  parent.append(overlay);

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

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  function summarise(doc: string): string {
    const tasks = doc.split("\n").filter((line) => line.trim() !== "").length;
    return `${tasks} line${tasks === 1 ? "" : "s"}`;
  }

  function choice(label: string, note: string, primary: boolean, run: () => Promise<void>) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sp-btn${primary ? " sp-btn--primary" : ""}`;
    button.textContent = label;
    button.title = note;
    button.addEventListener("click", async () => {
      box.querySelectorAll("button").forEach((b) => (b.disabled = true));
      await run();
      box.querySelectorAll("button").forEach((b) => (b.disabled = false));
      if (sync.status.kind === "synced") {
        close();
        onSettled();
      } else paint();
    });
    return button;
  }

  function paint(): void {
    box.replaceChildren();

    const heading = document.createElement("h2");
    heading.className = "sp-sync__title";
    heading.textContent = "Both devices changed the same lines";
    box.append(heading);

    const status = document.createElement("p");
    status.className = "sp-sync__status";
    const sides = sync.standoff;
    status.textContent =
      sync.status.kind === "error"
        ? sync.status.detail
        : sides
          ? `This device has ${summarise(sides.mine)}; the other has ${summarise(sides.theirs)}.`
          : "This device and another have both changed this pad.";
    box.append(status);

    const hint = document.createElement("p");
    hint.className = "sp-sync__hint";
    hint.textContent =
      "Everything that did not overlap has already been merged. Keeping both puts the other " +
      "device's list underneath yours so you can sort it out in the editor — nothing is lost.";
    box.append(hint);

    const actions = document.createElement("div");
    actions.className = "sp-sync__actions";
    actions.append(
      choice("Keep both", "Append the other device's list under yours", true, () =>
        sync.resolve("both"),
      ),
      choice("Keep this device", "Overwrite the other device's copy", false, () =>
        sync.resolve("local"),
      ),
      choice("Use the other device", "Replace what is here", false, () => sync.resolve("remote")),
    );
    box.append(actions);

    const later = document.createElement("button");
    later.type = "button";
    later.className = "sp-sync__later";
    later.textContent = "Decide later";
    later.addEventListener("click", close);
    box.append(later);
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
      box.querySelector("button")?.focus();
    },

    refresh(): void {
      if (!overlay.hidden) paint();
    },

    close,
  };
}

export type ConflictView = ReturnType<typeof createConflictView>;
