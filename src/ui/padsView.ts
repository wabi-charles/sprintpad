import { forgetPadLocally, knownPadIds, type StorageLike } from "../data/storage";
import { deletePadEverywhere, openOrCreatePad, padExists } from "../sync/pads";
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
              if (!result.ok) listNote(result.detail ?? "Could not delete the pad");
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

    // Failures from the list's own buttons, reported under the list itself.
    const listNote = problemLine();

    section(
      "Add a pad",
      "One name, one password. If the pad exists you join it; if it does not, " +
        "it is made as a copy of the list you are looking at now. The password is the key — " +
        "the server cannot read a pad, and nobody can reset it.",
    );

    const pad = fields();
    const note = problemLine();

    const submit = button(
      "Open or create pad",
      async () => {
        const padId = normalizePadId(pad.name.value);
        const shape = padIdProblem(padId);
        if (shape) return note(describePadIdProblem(shape));
        if (pad.password.value === "") return note("Enter a password. It cannot be reset.");

        submit.disabled = true;
        note("Working…");
        const result = await openOrCreatePad(
          hooks.backend,
          padId,
          pad.password.value,
          hooks.getDoc(),
        );
        submit.disabled = false;

        if (result.kind === "opened" || result.kind === "created") location.assign(padUrl(padId));
        else if (result.kind === "wrongPassword") note("That password does not open this pad.");
        else note(result.detail);
      },
      " sp-btn--primary",
    );
    submitOn([pad.name, pad.password], submit);
    buttonRow(submit);

    /*
     * Which of the two things the button will do, said before it is pressed --
     * otherwise a mistyped name quietly makes a pad instead of opening one.
     */
    let checking: ReturnType<typeof setTimeout> | null = null;
    pad.name.addEventListener("input", () => {
      if (checking) clearTimeout(checking);
      submit.textContent = "Open or create pad";
      note("");

      const padId = normalizePadId(pad.name.value);
      if (padIdProblem(padId) !== null) return;

      checking = setTimeout(async () => {
        const exists = await padExists(padId);
        // The field may have moved on while we asked.
        if (normalizePadId(pad.name.value) !== padId) return;
        if (exists === null) return;
        submit.textContent = exists ? "Open pad" : "Create pad";
        note(
          exists
            ? "That pad exists — enter its password to join it here."
            : "New pad — starts as a copy of the list you are looking at.",
        );
      }, 400);
    });

    function section(title: string, blurb: string): void {
      const el = document.createElement("h3");
      el.className = "sp-pads__subtitle";
      el.textContent = title;
      box.append(el);
      hint(blurb);
    }

    function hint(text: string): void {
      const el = document.createElement("p");
      el.className = "sp-pads__hint";
      el.textContent = text;
      box.append(el);
    }

    function fields(): { name: HTMLInputElement; password: HTMLInputElement } {
      return { name: field("Name", "text"), password: field("Password", "password") };
    }

    function field(label: string, type: string): HTMLInputElement {
      const rowEl = document.createElement("label");
      rowEl.className = "sp-pads__field";
      const caption = document.createElement("span");
      caption.textContent = label;
      const input = document.createElement("input");
      input.className = "sp-pads__input";
      input.type = type;
      rowEl.append(caption, input);
      box.append(rowEl);
      return input;
    }

    function problemLine(): (text: string) => void {
      const el = document.createElement("p");
      el.className = "sp-pads__problem";
      box.append(el);
      return (text) => {
        el.textContent = text;
      };
    }

    function submitOn(inputs: HTMLInputElement[], target: HTMLButtonElement): void {
      for (const input of inputs) {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") target.click();
        });
      }
    }

    function buttonRow(...controls: HTMLElement[]): void {
      const actions = document.createElement("div");
      actions.className = "sp-pads__actions";
      actions.append(...controls);
      box.append(actions);
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
