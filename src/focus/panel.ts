import { renderLinkedText } from "../ui/linkedText";
import { parseSessionLength } from "./timer";

/**
 * The focus area (§7A, §11-§13). It owns no state: `render` is given a view
 * model each tick and updates the DOM in place, so a button never loses focus
 * mid-session and the clock never re-creates itself.
 */

/** `extra` is how many further tasks the session covers beyond the first. */
export type PanelView =
  | { kind: "idle"; task: string | null; clock: string; editable: boolean }
  | { kind: "running"; task: string; extra: number; clock: string; countUp: boolean }
  | { kind: "paused"; task: string; extra: number; clock: string; countUp: boolean }
  | { kind: "expired"; task: string; extra: number; focused: string }
  | { kind: "break"; task: string; extra: number; clock: string; paused: boolean }
  | { kind: "finished"; task: string; extra: number; focused: string };

export interface PanelActions {
  /** Start a session on the task at the cursor. */
  start(): void;
  /** Set how long a focus session runs for, in seconds. */
  setDuration(seconds: number): void;
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
  disabled?: boolean;
}

function buttonsFor(view: PanelView, actions: PanelActions): ButtonSpec[] {
  switch (view.kind) {
    /*
     * Start is always here, greyed when there is nothing under the cursor to
     * start. The clock is on screen at rest now, and a timer showing 50:00
     * with no button beside it reads as broken rather than as waiting.
     */
    case "idle":
      return [
        {
          label: "Start",
          run: actions.start,
          primary: true,
          title: view.task === null ? "Put the cursor on a task" : "⌘⏎",
          disabled: view.task === null,
        },
      ];
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
  /** True while the session length is being typed into the clock. */
  let editingLength = false;

  /**
   * The clock is the setting.
   *
   * Now that it is on screen at rest, showing 50:00 and making you open a
   * dialog to change it would be a picture of a control rather than the
   * control. Click it and type.
   */
  clock.addEventListener("click", () => {
    if (clock.dataset.editable !== "true" || editingLength) return;
    editingLength = true;

    const input = document.createElement("input");
    input.className = "sp-focus__length";
    input.value = clock.textContent ?? "";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", "Session length in minutes");
    clock.replaceChildren(input);
    input.focus();
    input.select();

    const finish = (commit: boolean): void => {
      if (!editingLength) return;
      editingLength = false;
      if (commit) {
        const seconds = parseSessionLength(input.value);
        // A slip leaves the timer alone; there is no useful zero here.
        if (seconds !== null) actions.setDuration(seconds);
      }
      clock.replaceChildren();
      lastSignature = "";
    };

    input.addEventListener("keydown", (event) => {
      // Space pauses and Escape stops, at the panel level -- neither of which
      // should happen because someone is typing a number.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  });

  // §9: Space pauses and Escape ends, but only while the timer UI has focus --
  // in the workpad those keys have to keep their ordinary meaning.
  root.addEventListener("keydown", (event) => {
    if (event.key === " ") {
      const tag = (event.target as HTMLElement).tagName;
      if (tag === "BUTTON" || tag === "INPUT") return;
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

      renderLinkedText(
        task,
        view.kind === "idle" ? (view.task ?? "Select a task to focus on") : view.task,
      );

      const extra = view.kind === "idle" ? 0 : view.extra;
      alsoCount.textContent = extra > 0 ? `and ${extra} more task${extra === 1 ? "" : "s"}` : "";

      // Leave the clock alone while it is being typed into, or the render
      // loop would swallow the number mid-keystroke.
      if (!editingLength) {
        if (isTimed) {
          clock.textContent = view.clock;
          clock.dataset.countUp = String(view.kind === "running" && view.countUp);
        } else if (view.kind === "expired" || view.kind === "finished") {
          clock.textContent = `${view.focused} focused`;
        } else {
          clock.textContent = view.clock;
        }
      }
      clock.dataset.variant = isTimed || view.kind === "idle" ? "time" : "summary";
      clock.dataset.editable = String(view.kind === "idle" && view.editable);

      // Rebuilding the row only when the button set changes keeps focus stable.
      const specs = buttonsFor(view, actions);
      const signature = `${view.kind}:${specs.map((b) => `${b.label}${b.disabled ? "!" : ""}`).join(",")}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        row.replaceChildren(
          ...specs.map((spec) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `sp-btn${spec.primary ? " sp-btn--primary" : ""}`;
            button.textContent = spec.label;
            button.disabled = spec.disabled === true;
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
