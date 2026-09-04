import type { PadSync, SyncStatus } from "../sync/pad";
import { describePadIdProblem, normalizePadId, padIdProblem, padUrl } from "../sync/padId";

/**
 * Sync setup. Advanced, and reached only from the palette: the ordinary way to
 * use Sprintpad is the root, which is a pad that never leaves the browser.
 */
export function createSyncView(parent: HTMLElement, sync: PadSync, onChange: () => void) {
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

  function close(): void {
    overlay.hidden = true;
    const restore = restoreFocus;
    restoreFocus = null;
    restore?.();
  }

  function heading(text: string): void {
    const el = document.createElement("h2");
    el.className = "sp-sync__title";
    el.textContent = text;
    box.append(el);
  }

  function hint(text: string): void {
    const el = document.createElement("p");
    el.className = "sp-sync__hint";
    el.textContent = text;
    box.append(el);
  }

  function field(label: string, placeholder: string, type = "text") {
    const row = document.createElement("label");
    row.className = "sp-sync__row";
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.className = "sp-sync__input";
    input.type = type;
    input.placeholder = placeholder;
    row.append(name, input);
    box.append(row);
    return input;
  }

  function describe(status: SyncStatus): string {
    switch (status.kind) {
      case "working":
        return "Syncing…";
      case "synced":
        return `Synced ${new Date(status.at).toLocaleTimeString()}`;
      case "conflict":
        return "This device and another have both changed.";
      case "error":
        return status.detail;
      case "locked":
        return "Enter this pad's password to open it.";
      default:
        return "This list stays in this browser.";
    }
  }

  function actions(...buttons: HTMLButtonElement[]): void {
    const row = document.createElement("div");
    row.className = "sp-sync__actions";
    row.append(...buttons);
    box.append(row);
  }

  function button(label: string, run: () => void, primary = false): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `sp-btn${primary ? " sp-btn--primary" : ""}`;
    el.textContent = label;
    el.addEventListener("click", run);
    return el;
  }

  /** At the root: choose a name, and go to it. */
  function paintRoot(): void {
    heading("Sync across devices");
    hint(
      "Advanced. Give your pad a name and it gets its own address — sprintpad.app/happy — " +
        "which opens the same list anywhere, given the password. This page stays local.",
    );

    const name = field("Pad name", "happy");
    const problem = document.createElement("p");
    problem.className = "sp-sync__problem";
    box.append(problem);

    const go = button(
      "Create pad",
      () => {
        const id = normalizePadId(name.value);
        const trouble = padIdProblem(id);
        if (trouble) {
          problem.textContent = describePadIdProblem(trouble);
          return;
        }
        // The pad's page asks for the password; this one never does.
        location.assign(padUrl(id));
      },
      true,
    );
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") go.click();
    });
    actions(go);
  }

  /** On a pad that has not been opened on this device. */
  function paintLocked(): void {
    heading(`Pad “${sync.padId}”`);
    const status = document.createElement("p");
    status.className = "sp-sync__status";
    status.textContent = describe(sync.status);
    box.append(status);

    hint(
      "The password is the key, not a login — this pad is encrypted in your browser, so the " +
        "server cannot read it and nobody can reset the password for you.",
    );

    const password = field("Password", "", "password");
    const open = button(
      "Open pad",
      async () => {
        if (password.value === "") return;
        open.disabled = true;
        await sync.unlockWith(password.value);
        onChange();
        paint();
      },
      true,
    );
    password.addEventListener("keydown", (event) => {
      if (event.key === "Enter") open.click();
    });
    actions(open, button("Use the local list", () => location.assign("/")));
  }

  /** On a pad that is open and syncing. */
  function paintUnlocked(): void {
    heading(`Pad “${sync.padId}”`);
    const status = document.createElement("p");
    status.className = "sp-sync__status";
    status.textContent = describe(sync.status);
    box.append(status);

    const link = document.createElement("input");
    link.className = "sp-sync__key";
    link.readOnly = true;
    link.value = padUrl(sync.padId ?? "");
    link.addEventListener("focus", () => link.select());
    box.append(link);

    hint("Open that address on another device and enter the same password.");

    const buttons: HTMLButtonElement[] = [];
    if (sync.status.kind === "conflict") {
      buttons.push(
        button("Keep this device", async () => {
          await sync.resolve("local");
          onChange();
          paint();
        }),
        button("Take the other", async () => {
          await sync.resolve("remote");
          onChange();
          paint();
        }),
      );
    }
    buttons.push(
      button("Forget on this device", () => {
        sync.forget();
        paint();
      }),
    );
    actions(...buttons);
  }

  function paint(): void {
    box.replaceChildren();
    if (sync.padId === null) paintRoot();
    else if (!sync.isUnlocked) paintLocked();
    else paintUnlocked();
  }

  return {
    get isOpen(): boolean {
      return !overlay.hidden;
    },

    open(onClose: () => void): void {
      restoreFocus = onClose;
      paint();
      overlay.hidden = false;
      box.querySelector("input")?.focus();
    },

    refresh(): void {
      if (!overlay.hidden) paint();
    },

    close,
  };
}

export type SyncView = ReturnType<typeof createSyncView>;
