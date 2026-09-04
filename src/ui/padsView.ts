import { forgetPadLocally, knownPadIds, type StorageLike } from "../data/storage";
import { createPad, deletePadEverywhere } from "../sync/createPad";
import type { PadSync, SyncStatus } from "../sync/pad";
import { describePadIdProblem, normalizePadId, padIdProblem, padUrl } from "../sync/padId";

/**
 * The pads on this device: open one, make one, or remove one.
 *
 * The local list is always first and cannot be removed -- it is what the app
 * is without any of this.
 */
export interface PadsViewHooks {
  backend: StorageLike;
  sync: PadSync;
  /** The document as it stands, which seeds a newly created pad. */
  getDoc(): string;
  onChange(): void;
}

export function createPadsView(parent: HTMLElement, hooks: PadsViewHooks) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-pads";
  overlay.append(box);
  parent.append(overlay);

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

  let restoreFocus: (() => void) | null = null;
  /** The pad whose deletion is one more click away. */
  let confirming: string | null = null;

  function close(): void {
    overlay.hidden = true;
    confirming = null;
    const restore = restoreFocus;
    restoreFocus = null;
    restore?.();
  }

  function button(label: string, run: () => void, kind = ""): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `sp-btn${kind}`;
    el.textContent = label;
    el.addEventListener("click", run);
    return el;
  }

  function statusFor(padId: string): string {
    if (hooks.sync.padId !== padId) return "";
    const status: SyncStatus = hooks.sync.status;
    switch (status.kind) {
      case "synced":
        return `synced ${new Date(status.at).toLocaleTimeString()}`;
      case "working":
        return "syncing…";
      case "conflict":
        return "both changed";
      case "error":
        return status.detail;
      case "locked":
        return "locked";
      default:
        return "";
    }
  }

  function row(title: string, note: string, controls: HTMLElement[], current = false): HTMLElement {
    const el = document.createElement("div");
    // The open pad is marked rather than merely lacking an Open button, so its
    // emptier right-hand side reads as deliberate.
    el.className = `sp-pads__row${current ? " is-current" : ""}`;

    const label = document.createElement("div");
    label.className = "sp-pads__label";
    const name = document.createElement("span");
    name.className = "sp-pads__name";
    name.textContent = title;
    label.append(name);

    if (note !== "") {
      const meta = document.createElement("span");
      meta.className = "sp-pads__note";
      meta.textContent = note;
      label.append(meta);
    }

    const actions = document.createElement("div");
    actions.className = "sp-pads__actions";
    actions.append(...controls);

    el.append(label, actions);
    return el;
  }

  function paint(): void {
    box.replaceChildren();

    const heading = document.createElement("h2");
    heading.className = "sp-pads__title";
    heading.textContent = "Pads";
    box.append(heading);

    const here = hooks.sync.padId;

    box.append(
      row(
        "This browser",
        "stays on this device",
        here === null ? [] : [button("Open", () => location.assign("/"))],
        here === null,
      ),
    );

    for (const padId of knownPadIds(hooks.backend)) {
      const isHere = padId === here;
      const controls: HTMLElement[] = [];
      if (!isHere) controls.push(button("Open", () => location.assign(padUrl(padId))));

      if (confirming === padId) {
        controls.push(
          button(
            "Delete everywhere",
            async () => {
              const result = await deletePadEverywhere(hooks.backend, padId);
              confirming = null;
              if (!result.ok) problem(result.detail ?? "Could not delete the pad");
              else if (isHere) location.assign("/");
              else paint();
            },
            " sp-btn--danger",
          ),
          button("Cancel", () => {
            confirming = null;
            paint();
          }),
        );
      } else {
        controls.push(
          button("Remove here", () => {
            forgetPadLocally(hooks.backend, padId);
            if (isHere) location.assign("/");
            else paint();
          }),
          button("Delete…", () => {
            confirming = padId;
            paint();
          }),
        );
      }

      box.append(row(padId, isHere ? statusFor(padId) : "syncs across devices", controls, isHere));
    }

    const subheading = document.createElement("h3");
    subheading.className = "sp-pads__subtitle";
    subheading.textContent = "New pad";
    box.append(subheading);

    const blurb = document.createElement("p");
    blurb.className = "sp-pads__hint";
    blurb.textContent =
      "A pad gets its own address and syncs across devices. It starts as a copy of the list " +
      "you are looking at now. The password is the key — the server cannot read the pad, and " +
      "nobody can reset it for you.";
    box.append(blurb);

    const name = field("Name", "", "text");
    const password = field("Password", "", "password");

    const trouble = document.createElement("p");
    trouble.className = "sp-pads__problem";
    box.append(trouble);

    function problem(text: string): void {
      trouble.textContent = text;
    }

    const create = button(
      "Create pad",
      async () => {
        const padId = normalizePadId(name.value);
        const shape = padIdProblem(padId);
        if (shape) return problem(describePadIdProblem(shape));
        if (password.value === "") return problem("Choose a password. It cannot be reset.");

        create.disabled = true;
        problem("Creating…");
        const result = await createPad(hooks.backend, padId, password.value, hooks.getDoc());
        create.disabled = false;

        if (result.kind === "created") location.assign(padUrl(padId));
        else if (result.kind === "taken") problem("That name is taken. Open it instead.");
        else problem(result.detail);
      },
      " sp-btn--primary",
    );

    for (const input of [name, password]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") create.click();
      });
    }

    const actions = document.createElement("div");
    actions.className = "sp-pads__actions";
    actions.append(create);
    box.append(actions);

    function field(label: string, placeholder: string, type: string): HTMLInputElement {
      const rowEl = document.createElement("label");
      rowEl.className = "sp-pads__field";
      const caption = document.createElement("span");
      caption.textContent = label;
      const input = document.createElement("input");
      input.className = "sp-pads__input";
      input.type = type;
      input.placeholder = placeholder;
      rowEl.append(caption, input);
      box.append(rowEl);
      return input;
    }
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

export type PadsView = ReturnType<typeof createPadsView>;
