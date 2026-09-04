/**
 * The focus area (§7A, §11-§13). It owns no state: `render` is given a view
 * model each tick and updates the DOM in place, so a button never loses focus
 * mid-session and the clock never re-creates itself.
 */

/** `extra` is how many further tasks the session covers beyond the first. */
export type PanelView =
  | { kind: "idle"; task: string | null }
  | { kind: "running"; task: string; extra: number; clock: string; countUp: boolean }
  | { kind: "paused"; task: string; extra: number; clock: string; countUp: boolean }
  | { kind: "expired"; task: string; extra: number; focused: string }
  | { kind: "break"; task: string; extra: number; clock: string; paused: boolean }
  | { kind: "finished"; task: string; extra: number; focused: string };

export interface PanelActions {
  /** Start a session on the task at the cursor. */
  start(): void;
  togglePause(): void;
  done(): void;
  stop(): void;
  keepWorking(): void;
  takeBreak(): void;
  endBreak(): void;
}

interface ButtonSpec {
  label: string;
  run: () => void;
  primary?: boolean;
  title?: string;
}

function buttonsFor(view: PanelView, actions: PanelActions): ButtonSpec[] {
  switch (view.kind) {
    // Not a mobile affordance: there was no pointer route to starting a
    // session on any device, only a shortcut the panel described.
    case "idle":
      return view.task === null
        ? []
        : [{ label: "Start", run: actions.start, primary: true, title: "⌘⏎" }];
    case "running":
      return [
        { label: "Pause", run: actions.togglePause, title: "Space" },
        { label: "Done", run: actions.done, primary: true, title: "⌘D" },
        { label: "Stop", run: actions.stop, title: "Esc" },
      ];
    case "paused":
      return [
        { label: "Resume", run: actions.togglePause, title: "Space" },
        { label: "Done", run: actions.done, primary: true, title: "⌘D" },
        { label: "Stop", run: actions.stop, title: "Esc" },
      ];
    case "expired":
      return [
        { label: "Done", run: actions.done, primary: true },
        { label: "Keep working", run: actions.keepWorking },
        { label: "Take break", run: actions.takeBreak },
      ];
    case "break":
      return [
        { label: view.paused ? "Resume" : "Pause", run: actions.togglePause, title: "Space" },
        { label: "Skip break", run: actions.endBreak },
      ];
    default:
      return [];
  }
}

export function createFocusPanel(parent: HTMLElement, actions: PanelActions) {
  const root = document.createElement("section");
  root.className = "sp-focus";
  root.tabIndex = 0;
  root.setAttribute("aria-label", "Focus session");

  const label = document.createElement("p");
  label.className = "sp-focus__label";

  const task = document.createElement("h1");
  task.className = "sp-focus__task";

  // A session can cover several tasks; naming the first and counting the rest
  // keeps the panel about the work rather than about a list.
  const alsoCount = document.createElement("p");
  alsoCount.className = "sp-focus__also";

  const clock = document.createElement("div");
  clock.className = "sp-focus__clock";

  const row = document.createElement("div");
  row.className = "sp-focus__actions";

  root.append(label, task, alsoCount, clock, row);
  parent.append(root);

  let lastSignature = "";

  // §9: Space pauses and Escape ends, but only while the timer UI has focus --
  // in the workpad those keys have to keep their ordinary meaning.
  root.addEventListener("keydown", (event) => {
    if (event.key === " ") {
      if ((event.target as HTMLElement).tagName === "BUTTON") return;
      event.preventDefault();
      actions.togglePause();
    } else if (event.key === "Escape") {
      event.preventDefault();
      actions.stop();
    }
  });

  return {
    root,

    render(view: PanelView): void {
      root.dataset.kind = view.kind;

      const isTimed = view.kind === "running" || view.kind === "paused" || view.kind === "break";
      label.textContent =
        view.kind === "idle"
          ? "Ready to focus"
          : view.kind === "expired"
            ? "Focus complete"
            : view.kind === "finished"
              ? "Nice."
              : view.kind === "break"
                ? view.paused
                  ? "Break paused"
                  : "Break"
                : view.kind === "paused"
                  ? "Paused"
                  : "Focus";

      task.textContent =
        view.kind === "idle"
          ? (view.task ?? "Select a task to focus on")
          : view.task;

      const extra = view.kind === "idle" ? 0 : view.extra;
      alsoCount.textContent = extra > 0 ? `and ${extra} more task${extra === 1 ? "" : "s"}` : "";

      if (isTimed) {
        clock.textContent = view.clock;
        clock.dataset.countUp = String(view.kind === "running" && view.countUp);
      } else if (view.kind === "expired" || view.kind === "finished") {
        clock.textContent = `${view.focused} focused`;
      } else {
        clock.textContent = "";
      }
      clock.dataset.variant = isTimed ? "time" : "summary";

      // Rebuilding the row only when the button set changes keeps focus stable.
      const specs = buttonsFor(view, actions);
      const signature = `${view.kind}:${specs.map((b) => b.label).join(",")}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        row.replaceChildren(
          ...specs.map((spec) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `sp-btn${spec.primary ? " sp-btn--primary" : ""}`;
            button.textContent = spec.label;
            if (spec.title) button.title = spec.title;
            button.addEventListener("click", spec.run);
            return button;
          }),
        );
      }
    },
  };
}

export type FocusPanel = ReturnType<typeof createFocusPanel>;
