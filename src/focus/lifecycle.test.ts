import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../data/storage";
import { createSessionController, type FocusedTask } from "./lifecycle";

/**
 * Every session bug in this project lived in the wiring and was caught by
 * hand. These are those bugs, written down.
 */

const T0 = 1_700_000_000_000;

function harness(initial: string[] = ["Pay taxes"], settings: Partial<Settings> = {}) {
  let now = T0;
  // A stand-in document: task text, whether it is ticked, and where it is.
  let doc: FocusedTask[] = initial.map((text, i) => ({ from: i * 10, text, completed: false }));
  let anchored: number[] = [];

  const deps = {
    now: () => now,
    settings: () => ({ ...DEFAULT_SETTINGS, focusSec: 3000, breakSec: 600, ...settings }),
    /*
     * Mirrors resolveFocusedLines: positions first, so a task edited under the
     * anchor is still found, with the captured titles as the fallback.
     */
    locate: (tasks: readonly string[]) => {
      const byPosition = doc.filter((line) => anchored.includes(line.from));
      if (byPosition.length === tasks.length) return byPosition;
      return doc.filter((line) => tasks.includes(line.text));
    },
    candidates: () => doc,
    anchorTo: vi.fn((positions: readonly number[]) => {
      anchored = [...positions];
    }),
    clearAnchor: vi.fn(),
    completeAt: vi.fn((positions: readonly number[]) => {
      doc = doc.map((line) => (positions.includes(line.from) ? { ...line, completed: true } : line));
    }),
    persist: vi.fn(),
    notify: vi.fn(),
    chime: vi.fn(),
    unlockAudio: vi.fn(),
  };

  return {
    deps,
    controller: createSessionController(deps),
    advance: (seconds: number) => (now += seconds * 1000),
    removeTask: (text: string) => (doc = doc.filter((line) => line.text !== text)),
    renameTask: (from: string, to: string) => {
      doc = doc.map((line) => (line.text === from ? { ...line, text: to } : line));
    },
    get doc() {
      return doc;
    },
  };
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe("starting", () => {
  it("runs, anchors the tasks, and persists", () => {
    h.controller.startAtCursor();
    expect(h.controller.session?.phase).toBe("running");
    expect(h.deps.anchorTo).toHaveBeenCalledWith([0]);
    expect(h.deps.persist).toHaveBeenCalled();
  });

  it("unlocks audio while the keypress is still in hand", () => {
    h.controller.startAtCursor();
    expect(h.deps.unlockAudio).toHaveBeenCalledOnce();
  });

  it("does nothing when the cursor is not on a task", () => {
    const empty = harness([]);
    empty.controller.startAtCursor();
    expect(empty.controller.session).toBeNull();
  });

  it("replaces a running session rather than stacking one", () => {
    h.controller.startAtCursor();
    const first = h.controller.session?.id;
    h.controller.startAtCursor();
    expect(h.controller.session?.id).not.toBe(first);
  });

  it("covers every task it was given", () => {
    const many = harness(["one", "two", "three"]);
    many.controller.startAtCursor();
    expect(many.controller.session?.tasks).toEqual(["one", "two", "three"]);
  });
});

describe("the clock", () => {
  it("expires once the timer is up, announcing it exactly once", () => {
    h.controller.startAtCursor();
    h.advance(3000);
    h.controller.tick();
    h.controller.tick();

    expect(h.controller.session?.phase).toBe("expired");
    expect(h.deps.notify).toHaveBeenCalledOnce();
    expect(h.deps.chime).toHaveBeenCalledOnce();
  });

  it("never completes a task just because time ran out", () => {
    h.controller.startAtCursor();
    h.advance(3000);
    h.controller.tick();
    expect(h.deps.completeAt).not.toHaveBeenCalled();
    expect(h.doc[0]?.completed).toBe(false);
  });

  it("keeps working from expired, and pauses from running", () => {
    h.controller.startAtCursor();
    h.advance(3000);
    h.controller.tick();

    h.controller.toggleClock();
    expect(h.controller.session?.phase).toBe("running");
    h.controller.toggleClock();
    expect(h.controller.session?.phase).toBe("paused");
  });

  it("ends the session when a break runs out", () => {
    h.controller.startAtCursor();
    h.controller.takeBreak();
    expect(h.controller.session?.phase).toBe("break");

    h.advance(601);
    h.controller.tick();
    expect(h.controller.session).toBeNull();
  });
});

describe("finishing", () => {
  it("ticks every task in the group, then ends on the document change", () => {
    const many = harness(["one", "two"]);
    many.controller.startAtCursor();
    many.controller.complete();

    expect(many.deps.completeAt).toHaveBeenCalledWith([0, 10]);
    many.controller.noteDocChange();
    expect(many.controller.session).toBeNull();
  });

  it("does not end while only some of the group is done", () => {
    const many = harness(["one", "two"]);
    many.controller.startAtCursor();
    many.deps.completeAt([0]);

    many.controller.noteDocChange();
    expect(many.controller.session).not.toBeNull();
  });

  it("shows what it cost, then returns to idle", () => {
    h.controller.startAtCursor();
    h.advance(1020);
    h.controller.complete();
    h.controller.noteDocChange();

    expect(h.controller.view()).toMatchObject({ kind: "finished", focused: "17 minutes" });
    h.advance(6);
    expect(h.controller.view().kind).toBe("idle");
  });
});

describe("a session whose task disappears", () => {
  it("survives a brief absence, as during a cut and paste", () => {
    h.controller.startAtCursor();
    h.removeTask("Pay taxes");

    // The first tick starts the grace period; a second one inside it holds.
    h.controller.tick();
    h.advance(1);
    h.controller.tick();
    expect(h.controller.session).not.toBeNull();
  });

  it("ends once the task is really gone", () => {
    h.controller.startAtCursor();
    h.removeTask("Pay taxes");

    h.controller.tick();
    h.advance(3);
    h.controller.tick();
    expect(h.controller.session).toBeNull();
  });

  it("does not leave the panel naming a task that no longer exists", () => {
    h.controller.startAtCursor();
    h.removeTask("Pay taxes");
    h.controller.tick();
    h.advance(3);
    h.controller.tick();

    expect(h.controller.view().kind).not.toBe("running");
  });
});

describe("what the panel shows", () => {
  it("names the task at the cursor when idle, and offers nothing without one", () => {
    expect(h.controller.view()).toEqual({ kind: "idle", task: "Pay taxes" });
    expect(harness([]).controller.view()).toEqual({ kind: "idle", task: null });
  });

  it("counts a group in the idle state too", () => {
    expect(harness(["one", "two", "three"]).controller.view()).toEqual({
      kind: "idle",
      task: "one and 2 more",
    });
  });

  it("follows a task renamed mid-session", () => {
    h.controller.startAtCursor();
    h.renameTask("Pay taxes", "Pay taxes properly");
    expect(h.controller.view()).toMatchObject({ task: "Pay taxes properly" });
  });

  it("falls back to the captured title while the task is briefly missing", () => {
    h.controller.startAtCursor();
    h.removeTask("Pay taxes");
    expect(h.controller.view()).toMatchObject({ task: "Pay taxes" });
  });

  it("counts the rest of a group", () => {
    const many = harness(["one", "two", "three"]);
    many.controller.startAtCursor();
    expect(many.controller.view()).toMatchObject({ kind: "running", task: "one", extra: 2 });
  });

  it("shows the clock counting down, and up when asked", () => {
    h.controller.startAtCursor();
    h.advance(28);
    expect(h.controller.view()).toMatchObject({ clock: "49:32", countUp: false });

    const up = harness(["one"], { mode: "countup" });
    up.controller.startAtCursor();
    up.advance(28);
    expect(up.controller.view()).toMatchObject({ clock: "00:28", countUp: true });
  });
});

describe("restoring", () => {
  it("picks a session back up, clock and all", () => {
    h.controller.startAtCursor();
    const stored = { ...h.controller.session!, anchors: [0] };

    const later = harness();
    later.advance(600);
    later.controller.restore(stored);
    expect(later.controller.view()).toMatchObject({ kind: "running", clock: "40:00" });
  });

  it("starts idle when there is nothing stored", () => {
    h.controller.restore(null);
    expect(h.controller.session).toBeNull();
  });
});
