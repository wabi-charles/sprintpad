import type { PadSync, SyncStatus } from "../sync/pad";

/**
 * Sync setup. Deliberately tucked behind the palette and off by default: the
 * ordinary way to use Sprintpad is a pad that never leaves the browser.
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
    return { row, input };
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
      default:
        return "Off — this pad stays in this browser.";
    }
  }

  function paint(): void {
    box.replaceChildren();

    const heading = document.createElement("h2");
    heading.className = "sp-sync__title";
    heading.textContent = "Sync across devices";
    box.append(heading);

    const status = document.createElement("p");
    status.className = "sp-sync__status";
    status.textContent = describe(sync.status);
    box.append(status);

    if (sync.isOn) {
      const key = document.createElement("p");
      key.className = "sp-sync__key";
      key.textContent = sync.padKey ?? "";
      box.append(key);

      const hint = document.createElement("p");
      hint.className = "sp-sync__hint";
      hint.textContent =
        "Enter this pad name and the same password on another device to open the same list.";
      box.append(hint);

      const actions = document.createElement("div");
      actions.className = "sp-sync__actions";

      if (sync.status.kind === "conflict") {
        for (const [label, keep] of [
          ["Keep this device", "local"],
          ["Take the other", "remote"],
        ] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "sp-btn";
          button.textContent = label;
          button.addEventListener("click", async () => {
            await sync.resolve(keep);
            onChange();
            paint();
          });
          actions.append(button);
        }
      }

      const off = document.createElement("button");
      off.type = "button";
      off.className = "sp-btn";
      off.textContent = "Turn off";
      off.addEventListener("click", () => {
        sync.disconnect();
        paint();
      });
      actions.append(off);
      box.append(actions);
      return;
    }

    const blurb = document.createElement("p");
    blurb.className = "sp-sync__hint";
    blurb.textContent =
      "Advanced. Your pad is encrypted in this browser before it is sent, so the server " +
      "only ever holds an unreadable blob. There is no account — the password is the key, " +
      "and nobody can reset it for you.";
    box.append(blurb);

    const endpoint = field("Server", "https://sprintpad-sync.you.workers.dev", "url");
    const padKey = field("Pad name", "blank to create a new one");
    const password = field("Password", "", "password");
    endpoint.input.value = sync.endpoint ?? "";
    box.append(endpoint.row, padKey.row, password.row);

    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "sp-btn sp-btn--primary";
    connect.textContent = "Turn on sync";
    connect.addEventListener("click", async () => {
      if (endpoint.input.value.trim() === "" || password.input.value === "") return;
      connect.disabled = true;
      await sync.connect(endpoint.input.value, padKey.input.value, password.input.value);
      onChange();
      paint();
    });

    const actions = document.createElement("div");
    actions.className = "sp-sync__actions";
    actions.append(connect);
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
      box.querySelector("input")?.focus();
    },

    refresh(): void {
      if (!overlay.hidden) paint();
    },

    close,
  };
}

export type SyncView = ReturnType<typeof createSyncView>;
