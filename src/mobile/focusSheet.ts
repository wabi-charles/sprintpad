import type { PanelActions, PanelView } from "../focus/panel";

/**
 * The timer, as a sheet rather than a panel.
 *
 * A running session is the most important thing on the screen but not the only
 * thing: you still tick tasks off and add the one you just thought of. So it
 * lives at the bottom, full height while you are deciding something and a
 * single bar the rest of the time, where a thumb can reach it either way.
 */
export function createFocusSheet(parent: HTMLElement, actions: PanelActions) {
  const root = document.createElement("div");
  root.className = "sp-m-focus";
  root.hidden = true;
  parent.append(root);

  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = "sp-m-focus__bar";
  const barClock = document.createElement("span");
  barClock.className = "sp-m-focus__barclock";
  const barTask = document.createElement("span");
  barTask.className = "sp-m-focus__bartask";
  bar.append(barClock, barTask);
  bar.addEventListener("click", () => setExpanded(true));

  const sheet = document.createElement("div");
  sheet.className = "sp-m-focus__sheet";

  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "sp-m-focus__grip";
  grip.setAttribute("aria-label", "Minimise");
  grip.addEventListener("click", () => setExpanded(false));

  const label = document.createElement("p");
  label.className = "sp-m-focus__label";
  const task = document.createElement("h2");
  task.className = "sp-m-focus__task";
  const clock = document.createElement("p");
  clock.className = "sp-m-focus__clock";
  const buttons = document.createElement("div");
  buttons.className = "sp-m-focus__buttons";

  sheet.append(grip, label, task, clock, buttons);
  root.append(bar, sheet);

  let expanded = true;

  function setExpanded(next: boolean): void {
    expanded = next;
    root.classList.toggle("is-expanded", expanded);
  }

  function button(text: string, run: () => void, primary = false): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `sp-m-btn${primary ? " sp-m-btn--primary" : ""}`;
    el.textContent = text;
    el.addEventListener("click", run);
    return el;
  }

  function render(view: PanelView): void {
    // Idle is the list's ordinary state, and a sheet saying "nothing is
    // running" would be a permanent apology at the bottom of the screen.
    if (view.kind === "idle") {
      root.hidden = true;
      return;
    }

    root.hidden = false;
    if (view.kind === "expired" || view.kind === "finished") setExpanded(true);
    root.classList.toggle("is-expanded", expanded);
    root.dataset.state = view.kind;

    const extra = "extra" in view && view.extra > 0 ? ` +${view.extra}` : "";
    task.textContent = view.task + extra;
    barTask.textContent = view.task + extra;

    label.textContent =
      view.kind === "running"
        ? "Focusing"
        : view.kind === "paused"
          ? "Paused"
          : view.kind === "break"
            ? view.paused
              ? "Break paused"
              : "Break"
            : view.kind === "expired"
              ? "Time is up"
              : "Done";

    const time = "clock" in view ? view.clock : view.focused;
    clock.textContent = time;
    barClock.textContent = "clock" in view ? view.clock : "✓";

    buttons.replaceChildren();
    switch (view.kind) {
      case "running":
        buttons.append(
          button("Pause", actions.togglePause),
          button("Done", actions.done, true),
          button("Stop", actions.stop),
        );
        break;
      case "paused":
        buttons.append(
          button("Resume", actions.togglePause),
          button("Done", actions.done, true),
          button("Stop", actions.stop),
        );
        break;
      case "expired":
        buttons.append(
          button("Done", actions.done, true),
          button("Keep working", actions.keepWorking),
          button("Take break", actions.takeBreak),
        );
        break;
      case "break":
        buttons.append(button("End break", actions.endBreak, true));
        break;
      case "finished":
        break;
    }
  }

  return {
    render,
    get isVisible(): boolean {
      return !root.hidden;
    },
    get isExpanded(): boolean {
      return !root.hidden && expanded;
    },
  };
}

export type FocusSheet = ReturnType<typeof createFocusSheet>;
