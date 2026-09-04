import { padLink } from "../sync/endpoint";
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
  /** A pad handed over by link, waiting for its password. */
  let pendingPadKey: string | null = null;

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
      // The link is the pad name: far easier to send to a phone than to type.
      const link = document.createElement("input");
      link.className = "sp-sync__key";
      link.readOnly = true;
      link.value = padLink(sync.padKey ?? "");
      link.addEventListener("focus", () => link.select());
      box.append(link);

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "sp-btn";
      copy.textContent = "Copy link";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(link.value);
          copy.textContent = "Copied";
        } catch {
          link.focus();
        }
      });

      const hint = document.createElement("p");
      hint.className = "sp-sync__hint";
      hint.textContent =
        "Open this link on another device and enter the same password. Keep it private — " +
        "the link plus the password opens your list.";
      box.append(hint);

      const actions = document.createElement("div");
      actions.className = "sp-sync__actions";
      actions.append(copy);

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

    const password = field("Password", "", "password");
    box.append(password.row);

    // Arriving from a shared link: the pad is already chosen, so only the
    // password is asked for.
    const joining = pendingPadKey !== null;
    if (joining) {
      const note = document.createElement("p");
      note.className = "sp-sync__hint";
      note.textContent = "Joining the pad from your link.";
      box.append(note);
    }

    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "sp-btn sp-btn--primary";
    connect.textContent = joining ? "Open this pad" : "Turn on sync";
    connect.addEventListener("click", async () => {
      if (password.input.value === "") return;
      connect.disabled = true;
      await sync.connect(pendingPadKey ?? "", password.input.value);
      pendingPadKey = null;
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

    /** Opens ready to join the pad a link named. */
    openForPad(padKey: string, onClose: () => void): void {
      pendingPadKey = padKey;
      restoreFocus = onClose;
      paint();
      overlay.hidden = false;
      box.querySelector("input")?.focus();
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
