import { trapFocus } from "./focusTrap";
import { describeSnapshot, formatAge, type Snapshot } from "../data/snapshots";

/**
 * Earlier versions of the document. Undo covers the current session; this
 * covers the reload that threw the undo history away.
 */
export function createSnapshotsView(
  parent: HTMLElement,
  getSnapshots: () => readonly Snapshot[],
  onRestore: (doc: string) => void,
) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-versions";
  box.tabIndex = -1;
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
    const heading = document.createElement("h2");
    heading.className = "sp-versions__title";
    heading.textContent = "Earlier versions";
    box.replaceChildren(heading);

    const list = getSnapshots();
    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sp-versions__empty";
      empty.textContent = "No earlier versions yet. They are kept as you work.";
      box.append(empty);
      return;
    }

    const now = Date.now();
    // Newest first: the most recent version is the one you almost always want.
    for (const snapshot of [...list].reverse()) {
      const { title, tasks } = describeSnapshot(snapshot.doc);

      const row = document.createElement("button");
      row.type = "button";
      row.className = "sp-versions__row";

      const when = document.createElement("span");
      when.className = "sp-versions__when";
      when.textContent = formatAge(snapshot.at, now);

      const detail = document.createElement("span");
      detail.className = "sp-versions__detail";
      detail.textContent = `${tasks} task${tasks === 1 ? "" : "s"} — ${title}`;

      row.append(when, detail);
      row.addEventListener("click", () => {
        close();
        onRestore(snapshot.doc);
      });
      box.append(row);
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
      releaseTrap = trapFocus(box);
      box.focus();
    },

    close,
  };
}

export type SnapshotsView = ReturnType<typeof createSnapshotsView>;
