import { todayTotals, type FocusRecord } from "../data/history";
import { formatDurationShort } from "../focus/timer";

/** §17: today's focus, and nothing more. Not a time-tracking platform. */
export function createHistoryView(parent: HTMLElement, getLog: () => readonly FocusRecord[]) {
  const overlay = document.createElement("div");
  overlay.className = "sp-overlay";
  overlay.hidden = true;

  const box = document.createElement("div");
  box.className = "sp-history";
  overlay.append(box);
  parent.append(overlay);

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  let restoreFocus: (() => void) | null = null;

  function close(): void {
    overlay.hidden = true;
    const restore = restoreFocus;
    restoreFocus = null;
    restore?.();
  }

  function paint(): void {
    const { rows, totalSeconds } = todayTotals(getLog(), Date.now());

    const heading = document.createElement("h2");
    heading.className = "sp-history__title";
    heading.textContent = "Today";

    box.replaceChildren(heading);

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sp-history__empty";
      empty.textContent = "No focus sessions yet today.";
      box.append(empty);
      return;
    }

    const table = document.createElement("table");
    table.className = "sp-history__table";
    const body = document.createElement("tbody");

    for (const row of rows) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = row.taskText;
      const time = document.createElement("td");
      time.className = "sp-history__time";
      time.textContent = formatDurationShort(row.seconds);
      tr.append(name, time);
      body.append(tr);
    }

    const footer = document.createElement("tr");
    footer.className = "sp-history__total";
    const totalLabel = document.createElement("td");
    totalLabel.textContent = "Total focused";
    const totalValue = document.createElement("td");
    totalValue.className = "sp-history__time";
    totalValue.textContent = formatDurationShort(totalSeconds);
    footer.append(totalLabel, totalValue);
    body.append(footer);

    table.append(body);
    box.append(table);
  }

  return {
    get isOpen(): boolean {
      return !overlay.hidden;
    },

    open(onClose: () => void): void {
      restoreFocus = onClose;
      paint();
      overlay.hidden = false;
      box.tabIndex = -1;
      box.focus();
    },

    close,
  };
}

export type HistoryView = ReturnType<typeof createHistoryView>;
