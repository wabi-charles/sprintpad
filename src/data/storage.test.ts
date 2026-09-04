import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, DOC_VERSION, createStore, debounce, type StorageLike } from "./storage";

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
    keys: () => Object.keys(data),
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

  it("stamps the document version on save", () => {
    const backend = fakeBackend();
    createStore(backend).saveDoc("one");
    expect(backend.data["sprintpad.docVersion"]).toBe(String(DOC_VERSION));
  });
});

describe("document migration", () => {
  it("reinterprets an unversioned v1 document, where bare lines were headers", () => {
    const backend = fakeBackend({ "sprintpad.doc": "TODAY\n[] one\n[x] two" });
    expect(createStore(backend).loadDoc()).toBe("# TODAY\none\n[x] two");
  });

  it("writes the result back so the migration only ever runs once", () => {
    const backend = fakeBackend({ "sprintpad.doc": "TODAY\n[] one" });
    createStore(backend).loadDoc();
    expect(backend.data["sprintpad.docVersion"]).toBe(String(DOC_VERSION));
    expect(createStore(backend).loadDoc()).toBe("# TODAY\none");
  });

  it("leaves a current document untouched", () => {
    const backend = fakeBackend({
      "sprintpad.doc": "# TODAY\none",
      "sprintpad.docVersion": String(DOC_VERSION),
    });
    expect(createStore(backend).loadDoc()).toBe("# TODAY\none");
  });

  it("treats a corrupt version stamp as legacy rather than skipping the migration", () => {
    const backend = fakeBackend({ "sprintpad.doc": "TODAY", "sprintpad.docVersion": "junk" });
    expect(createStore(backend).loadDoc()).toBe("# TODAY");
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

describe("snapshots", () => {
  it("round-trips versions", () => {
    const backend = fakeBackend();
    createStore(backend).saveSnapshots([{ at: 1, doc: "one" }]);
    expect(createStore(backend).loadSnapshots()).toEqual([{ at: 1, doc: "one" }]);
  });

  it("returns an empty log for missing or malformed storage", () => {
    expect(createStore(fakeBackend()).loadSnapshots()).toEqual([]);
    expect(createStore(fakeBackend({ "sprintpad.snapshots": "{{{" })).loadSnapshots()).toEqual([]);
    expect(createStore(fakeBackend({ "sprintpad.snapshots": '{"a":1}' })).loadSnapshots()).toEqual([]);
  });

  it("drops malformed entries rather than the whole log", () => {
    const backend = fakeBackend({
      "sprintpad.snapshots": '[{"at":1,"doc":"one"},{"at":"nope"},{"doc":"no time"}]',
    });
    expect(createStore(backend).loadSnapshots()).toEqual([{ at: 1, doc: "one" }]);
  });
});

describe("pad credentials", () => {
  const credentials = {
    salt: "c2FsdA==",
    password: "hunter2",
    lastSynced: { doc: "one", updatedAt: 42 },
  };

  it("is absent until a pad has been opened", () => {
    expect(createStore(fakeBackend(), "happy").loadCredentials()).toBeNull();
  });

  it("round-trips", () => {
    const backend = fakeBackend();
    createStore(backend, "happy").saveCredentials(credentials);
    expect(createStore(backend, "happy").loadCredentials()).toEqual(credentials);
  });

  it("is kept per pad, so one pad's password never opens another", () => {
    const backend = fakeBackend();
    createStore(backend, "happy").saveCredentials(credentials);
    expect(createStore(backend, "work").loadCredentials()).toBeNull();
    expect(createStore(backend, "").loadCredentials()).toBeNull();
  });

  it("clears when forgotten", () => {
    const backend = fakeBackend();
    const store = createStore(backend, "happy");
    store.saveCredentials(credentials);
    store.saveCredentials(null);
    expect(store.loadCredentials()).toBeNull();
  });

  it("discards anything missing what it needs", () => {
    for (const bad of ['{"salt":"s"}', "{{{", '{"password":"p"}']) {
      expect(createStore(fakeBackend({ "sprintpad.pad@happy": bad }), "happy").loadCredentials())
        .toBeNull();
    }
  });

  it("drops a malformed sync point rather than the whole record", () => {
    const backend = fakeBackend({
      "sprintpad.pad@happy": JSON.stringify({ ...credentials, lastSynced: { doc: 5 } }),
    });
    expect(createStore(backend, "happy").loadCredentials()).toMatchObject({ lastSynced: null });
  });
});

describe("scoping", () => {
  it("keeps each pad's document, history and session apart", () => {
    const backend = fakeBackend();
    const root = createStore(backend, "");
    const happy = createStore(backend, "happy");

    root.saveDoc("local");
    happy.saveDoc("shared");
    root.saveSnapshots([{ at: 1, doc: "local before" }]);

    expect(root.loadDoc()).toBe("local");
    expect(happy.loadDoc()).toBe("shared");
    expect(happy.loadSnapshots()).toEqual([]);
  });

  it("shares settings, which are about the person and not the pad", () => {
    const backend = fakeBackend();
    createStore(backend, "").saveSettings({ ...DEFAULT_SETTINGS, focusSec: 1500 });
    expect(createStore(backend, "happy").loadSettings().focusSec).toBe(1500);
  });
});

describe("session", () => {
  const session = {
    id: "s1",
    tasks: ["Claude data setup"],
    anchors: [12],
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

  it("carries a single-task session from the old shape forward", () => {
    const legacy = JSON.stringify({
      id: "s1",
      taskText: "Claude data setup",
      anchor: 12,
      phase: "running",
      startedAt: 1700,
      timer: { mode: "countdown", durationSec: 3000, startedAt: 1700, accumulatedSec: 0, running: true },
    });
    expect(createStore(fakeBackend({ "sprintpad.session": legacy })).loadSession()).toMatchObject({
      tasks: ["Claude data setup"],
      anchors: [12],
    });
  });

  it("discards a session with no tasks at all", () => {
    const empty = JSON.stringify({
      id: "s1",
      tasks: [],
      anchors: [],
      phase: "running",
      startedAt: 1700,
      timer: { mode: "countdown", durationSec: 3000, startedAt: 1700, accumulatedSec: 0, running: true },
    });
    expect(createStore(fakeBackend({ "sprintpad.session": empty })).loadSession()).toBeNull();
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
      keys: () => {
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
