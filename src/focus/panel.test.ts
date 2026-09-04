/**
 * @vitest-environment jsdom
 *
 * The focus panel renders in place rather than rebuilding, so its states are
 * easy to get subtly wrong -- a stale button, a count that does not clear.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFocusPanel, type PanelView } from "./panel";

const actions = {
  start: vi.fn(),
  togglePause: vi.fn(),
  done: vi.fn(),
  stop: vi.fn(),
  keepWorking: vi.fn(),
  takeBreak: vi.fn(),
  endBreak: vi.fn(),
};

let panel: ReturnType<typeof createFocusPanel>;
let root: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  panel = createFocusPanel(host, actions);
  root = host.querySelector(".sp-focus")!;
});

const buttons = () => [...root.querySelectorAll(".sp-btn")].map((b) => b.textContent);
const text = (selector: string) => root.querySelector(selector)?.textContent ?? "";

const running: PanelView = { kind: "running", task: "Pay taxes", extra: 0, clock: "49:59", countUp: false };

describe("the idle panel", () => {
  it("offers no control when the cursor is not on a task", () => {
    panel.render({ kind: "idle", task: null });
    expect(text(".sp-focus__task")).toBe("Select a task to focus on");
    expect(buttons()).toEqual([]);
  });

  it("names the task and offers Start when it is", () => {
    panel.render({ kind: "idle", task: "Pay taxes" });
    expect(text(".sp-focus__task")).toBe("Pay taxes");
    expect(buttons()).toEqual(["Start"]);
  });

  it("carries the shortcut on the button rather than replacing it", () => {
    panel.render({ kind: "idle", task: "Pay taxes" });
    expect(root.querySelector(".sp-btn")?.getAttribute("title")).toBe("⌘⏎");
  });

  it("starts the session when pressed", () => {
    panel.render({ kind: "idle", task: "Pay taxes" });
    root.querySelector<HTMLButtonElement>(".sp-btn")!.click();
    expect(actions.start).toHaveBeenCalledOnce();
  });
});

describe("session states", () => {
  it("shows the clock and controls while running", () => {
    panel.render(running);
    expect(text(".sp-focus__clock")).toBe("49:59");
    expect(buttons()).toEqual(["Pause", "Done", "Stop"]);
  });

  it("offers Resume rather than Pause when paused", () => {
    panel.render({ ...running, kind: "paused" });
    expect(buttons()).toEqual(["Resume", "Done", "Stop"]);
  });

  it("offers the three choices when time is up, and completes nothing itself", () => {
    panel.render({ kind: "expired", task: "Pay taxes", extra: 0, focused: "50 minutes" });
    expect(buttons()).toEqual(["Done", "Keep working", "Take break"]);
    expect(actions.done).not.toHaveBeenCalled();
  });

  it("counts the rest of a group, and clears the count when it is one task", () => {
    panel.render({ ...running, extra: 2 });
    expect(text(".sp-focus__also")).toBe("and 2 more tasks");
    panel.render({ ...running, extra: 1 });
    expect(text(".sp-focus__also")).toBe("and 1 more task");
    panel.render(running);
    expect(text(".sp-focus__also")).toBe("");
  });
});

describe("re-rendering", () => {
  it("keeps the same button elements while the set is unchanged", () => {
    panel.render(running);
    const first = root.querySelector(".sp-btn");
    panel.render({ ...running, clock: "49:58" });
    // Rebuilding every tick would drop focus from whatever the user is on.
    expect(root.querySelector(".sp-btn")).toBe(first);
  });

  it("swaps the controls when the state changes", () => {
    panel.render(running);
    panel.render({ kind: "idle", task: null });
    expect(buttons()).toEqual([]);
  });
});

describe("keys while the panel has focus", () => {
  it("pauses on Space and ends on Escape", () => {
    panel.render(running);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(actions.togglePause).toHaveBeenCalledOnce();
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(actions.stop).toHaveBeenCalledOnce();
  });
});
