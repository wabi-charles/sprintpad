import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, createStore, debounce, type StorageLike } from "./storage";

function fakeBackend(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe("document persistence", () => {
  it("round-trips the document", () => {
    const backend = fakeBackend();
    createStore(backend).saveDoc("TODAY\n[] one");
    expect(createStore(backend).loadDoc()).toBe("TODAY\n[] one");
  });

  it("returns null on first run so the caller can seed a starter document", () => {
    expect(createStore(fakeBackend()).loadDoc()).toBeNull();
  });

  it("keeps an empty document rather than treating it as absent", () => {
    const backend = fakeBackend();
    createStore(backend).saveDoc("");
    expect(createStore(backend).loadDoc()).toBe("");
  });
});

describe("settings", () => {
  it("falls back to defaults when nothing is stored", () => {
    expect(createStore(fakeBackend()).loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips settings", () => {
    const backend = fakeBackend();
    createStore(backend).saveSettings({ ...DEFAULT_SETTINGS, focusSec: 1500, theme: "dark" });
    expect(createStore(backend).loadSettings()).toMatchObject({ focusSec: 1500, theme: "dark" });
  });

  it("repairs partial or corrupt settings instead of throwing", () => {
    expect(createStore(fakeBackend({ "sprintpad.settings": "{{{" })).loadSettings()).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(
      createStore(fakeBackend({ "sprintpad.settings": '{"focusSec":1500}' })).loadSettings(),
    ).toEqual({ ...DEFAULT_SETTINGS, focusSec: 1500 });
  });

  it("rejects nonsensical durations", () => {
    const store = createStore(fakeBackend({ "sprintpad.settings": '{"focusSec":-4,"breakSec":0}' }));
    expect(store.loadSettings().focusSec).toBe(DEFAULT_SETTINGS.focusSec);
    expect(store.loadSettings().breakSec).toBe(DEFAULT_SETTINGS.breakSec);
  });
});

describe("history", () => {
  it("round-trips records and drops malformed ones", () => {
    const backend = fakeBackend();
    createStore(backend).saveHistory([
      { id: "a", taskText: "one", startedAt: 1, seconds: 60, completed: false },
    ]);
    expect(createStore(backend).loadHistory()).toHaveLength(1);

    const corrupt = fakeBackend({ "sprintpad.history": '[{"id":"a"},{"nope":true}]' });
    expect(createStore(corrupt).loadHistory()).toEqual([]);
  });

  it("returns an empty log when storage holds a non-array", () => {
    expect(createStore(fakeBackend({ "sprintpad.history": '{"a":1}' })).loadHistory()).toEqual([]);
  });
});

describe("session", () => {
  const session = {
    id: "s1",
    taskText: "Claude data setup",
    anchor: 12,
    phase: "running" as const,
    startedAt: 1700,
    timer: {
      mode: "countdown" as const,
      durationSec: 3000,
      startedAt: 1700,
      accumulatedSec: 0,
      running: true,
    },
  };

  it("round-trips a running session so a reload can resume it", () => {
    const backend = fakeBackend();
    createStore(backend).saveSession(session);
    expect(createStore(backend).loadSession()).toEqual(session);
  });

  it("clears the session when saving null", () => {
    const backend = fakeBackend();
    const store = createStore(backend);
    store.saveSession(session);
    store.saveSession(null);
    expect(store.loadSession()).toBeNull();
  });

  it("discards a corrupt session rather than resuming a broken timer", () => {
    expect(createStore(fakeBackend({ "sprintpad.session": '{"phase":"running"}' })).loadSession())
      .toBeNull();
  });
});

describe("unavailable storage", () => {
  it("degrades to in-memory behaviour instead of crashing", () => {
    const backend: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createStore(backend);
    expect(() => store.saveDoc("x")).not.toThrow();
    expect(store.loadDoc()).toBeNull();
    expect(store.loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("debounce", () => {
  it("collapses a burst into one trailing call", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);
    debounced("a");
    debounced("b");
    debounced("c");
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledExactlyOnceWith("c");
    vi.useRealTimers();
  });

  it("flushes pending work on demand", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);
    debounced("a");
    debounced.flush();
    expect(spy).toHaveBeenCalledExactlyOnceWith("a");
    vi.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
