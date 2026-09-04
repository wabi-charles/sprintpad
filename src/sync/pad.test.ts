/**
 * The wiring around sync, exercised against a fake server. This layer had no
 * coverage and is where a silent data loss would actually happen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StorageLike } from "../data/storage";
import { createPadSync } from "./pad";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    keys: () => [...data.keys()],
  };
}

/** A stand-in for the Worker: the same contract, in memory. */
function fakeServer() {
  const pads = new Map<string, { payload: unknown; updatedAt: number; auth?: string }>();
  let clock = 1_000;

  const handler = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = url.pathname.replace("/pad/", "");
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if ((init?.method ?? "GET") === "GET") {
      const stored = pads.get(key);
      // The token never leaves the server.
      return stored ? json({ payload: stored.payload, updatedAt: stored.updatedAt }) : json({ error: "not found" }, 404);
    }

    const auth = new Headers(init?.headers).get("x-pad-auth");
    if (!auth) return json({ error: "missing write token" }, 401);

    const current = pads.get(key);
    if (current?.auth && current.auth !== auth) return json({ error: "forbidden" }, 403);

    const prev = url.searchParams.get("prev");
    if (prev !== null && current && String(current.updatedAt) !== prev) {
      return json({ error: "conflict" }, 409);
    }
    const updatedAt = (clock += 1000);
    pads.set(key, { payload: JSON.parse(String(init?.body)), updatedAt, auth });
    return json({ updatedAt });
  });

  return { pads, handler, editRemotely: (key: string) => {
    const stored = pads.get(key);
    if (stored) pads.set(key, { ...stored, updatedAt: (clock += 1000) });
  } };
}

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  server = fakeServer();
  vi.stubGlobal("fetch", server.handler);
});

afterEach(() => vi.unstubAllGlobals());

function harness(initialDoc: string, padId: string | null = "happy") {
  let doc = initialDoc;
  const store = createStore(memoryStorage(), padId ?? "");
  const applied: string[] = [];
  const statuses: string[] = [];
  const sync = createPadSync({
    padId,
    store,
    getDoc: () => doc,
    applyRemote: (next) => {
      doc = next;
      applied.push(next);
    },
    onStatus: (status) => void statuses.push(status.kind),
  });
  return {
    sync,
    store,
    applied,
    statuses,
    get doc() { return doc; },
    setDoc: (v: string) => (doc = v),
  };
}

describe("the root", () => {
  it("is local, and touches no network whatever happens", async () => {
    const { sync, store } = harness("one", null);
    expect(sync.status).toEqual({ kind: "local" });
    expect(sync.isUnlocked).toBe(false);
    await sync.sync();
    await sync.unlockWith("pw");
    expect(server.handler).not.toHaveBeenCalled();
    expect(store.loadCredentials()).toBeNull();
  });
});

describe("opening a pad", () => {
  it("starts locked until a password is given", () => {
    const { sync } = harness("one");
    expect(sync.status).toEqual({ kind: "locked" });
    expect(sync.isUnlocked).toBe(false);
  });

  it("creates the pad and uploads what is here", async () => {
    const { sync, store } = harness("# TODAY\nShip it");
    await sync.unlockWith("hunter2");

    expect(sync.isUnlocked).toBe(true);
    expect(sync.status).toMatchObject({ kind: "synced" });
    expect(store.loadCredentials()).not.toBeNull();
    expect(server.pads.size).toBe(1);
  });

  it("stores ciphertext, never the document", async () => {
    const { sync } = harness("# TODAY\nPay taxes");
    await sync.unlockWith("hunter2");
    expect(JSON.stringify([...server.pads.values()])).not.toContain("Pay taxes");
  });

  it("keeps each pad's document apart from the root's", () => {
    const backend = memoryStorage();
    createStore(backend, "").saveDoc("local list");
    createStore(backend, "happy").saveDoc("shared list");
    expect(createStore(backend, "").loadDoc()).toBe("local list");
    expect(createStore(backend, "happy").loadDoc()).toBe("shared list");
  });
});

describe("a second device", () => {
  it("opens the same pad with the same password", async () => {
    const first = harness("# TODAY\nFrom device A");
    await first.sync.unlockWith("hunter2");

    const second = harness("# TODAY\nUntouched starter");
    await second.sync.unlockWith("hunter2");

    expect(second.doc).toBe("# TODAY\nFrom device A");
  });

  it("refuses the wrong password and leaves the document alone", async () => {
    const first = harness("# TODAY\nSecret");
    await first.sync.unlockWith("right");

    const second = harness("# TODAY\nMine");
    await second.sync.unlockWith("wrong");

    expect(second.sync.isUnlocked).toBe(false);
    expect(second.store.loadCredentials()).toBeNull();
    expect(second.doc).toBe("# TODAY\nMine");
  });

  it("cannot overwrite a pad it does not know the password for", async () => {
    const owner = harness("owned");
    await owner.sync.unlockWith("right");

    // A stranger who guessed the name is refused at the door.
    const stranger = harness("vandalism");
    await stranger.sync.unlockWith("guessed");

    expect(stranger.sync.isUnlocked).toBe(false);
    expect(server.pads.size).toBe(1);
    await owner.sync.sync();
    expect(owner.sync.status).toMatchObject({ kind: "synced" });
  });
});

describe("keeping in step", () => {
  it("pushes a local edit", async () => {
    const { sync, setDoc } = harness("one");
    await sync.unlockWith("pw");
    const before = server.pads.get("happy")!.updatedAt;

    setDoc("one edited");
    await sync.sync();
    expect(server.pads.get("happy")!.updatedAt).toBeGreaterThan(before);
  });

  it("does nothing when neither side moved", async () => {
    const { sync } = harness("one");
    await sync.unlockWith("pw");
    const calls = server.handler.mock.calls.length;
    await sync.sync();
    // One read to check, and no write.
    expect(server.handler.mock.calls.length).toBe(calls + 1);
  });

  it("reports a conflict when both sides moved, rather than picking one", async () => {
    const { sync, setDoc, doc } = harness("one");
    await sync.unlockWith("pw");

    setDoc("changed here");
    server.editRemotely("happy");
    await sync.sync();

    expect(sync.status).toEqual({ kind: "conflict" });
    expect(doc).toBe("one");
  });

  it("resolves a conflict by keeping this device", async () => {
    const { sync, setDoc } = harness("one");
    await sync.unlockWith("pw");
    setDoc("changed here");
    server.editRemotely("happy");
    await sync.sync();

    await sync.resolve("local");
    expect(sync.status).toMatchObject({ kind: "synced" });
  });
});

describe("when the network is down", () => {
  it("surfaces the failure and keeps the document", async () => {
    const { sync, doc } = harness("one");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await sync.unlockWith("pw");

    expect(sync.status).toMatchObject({ kind: "error" });
    expect(doc).toBe("one");
  });
});

describe("turning sync off", () => {
  it("forgets the pad and stops syncing", async () => {
    const { sync, store } = harness("one");
    await sync.unlockWith("pw");
    sync.forget();

    expect(sync.isUnlocked).toBe(false);
    expect(store.loadCredentials()).toBeNull();
    const calls = server.handler.mock.calls.length;
    await sync.sync();
    expect(server.handler.mock.calls.length).toBe(calls);
  });
});

describe("a connection that fails", () => {
  it("leaves the browser local, with nothing stored", async () => {
    const first = harness("# TODAY\nSecret");
    await first.sync.unlockWith("right");

    const second = harness("# TODAY\nMine");
    await second.sync.unlockWith("wrong");

    // Otherwise every later visit comes up in a broken sync state.
    expect(second.sync.isUnlocked).toBe(false);
    expect(second.store.loadCredentials()).toBeNull();
    expect(second.sync.status).toMatchObject({ kind: "error" });
  });

  it("leaves nothing stored when the server cannot be reached", async () => {
    const { sync, store } = harness("one");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await sync.unlockWith("pw");

    expect(sync.isUnlocked).toBe(false);
    expect(store.loadCredentials()).toBeNull();
  });

  it("does not disturb a pad that was already working", async () => {
    const { sync, store } = harness("one");
    await sync.unlockWith("pw");
    const working = store.loadCredentials();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await sync.unlockWith("pw");

    expect(sync.isUnlocked).toBe(true);
    expect(store.loadCredentials()).toEqual(working);
  });

  it("stores the pad only once a sync has actually succeeded", async () => {
    const { sync, store } = harness("one");
    expect(store.loadCredentials()).toBeNull();
    await sync.unlockWith("pw");
    expect(store.loadCredentials()).not.toBeNull();
  });
});

/**
 * The case the whole feature exists for, and the one that had no coverage:
 * two devices on one pad, where the second only learns of the first's edit
 * because something asked. Nothing is pushed from the server.
 */
describe("a pad open on two devices", () => {
  const PASSWORD = "correct horse battery staple";

  async function twoDevices(doc: string) {
    const phone = harness(doc);
    await phone.sync.unlockWith(PASSWORD);
    const desk = harness(doc);
    await desk.sync.unlockWith(PASSWORD);
    return { phone, desk };
  }

  it("picks up the other device's edit on a poll", async () => {
    const { phone, desk } = await twoDevices("shared start");

    phone.setDoc("written on the phone");
    await phone.sync.sync();

    expect(desk.doc).toBe("shared start");
    await desk.sync.sync({ quiet: true });
    expect(desk.doc).toBe("written on the phone");
    expect(desk.sync.status).toMatchObject({ kind: "synced" });
  });

  it("keeps polling in step over several rounds", async () => {
    const { phone, desk } = await twoDevices("one");

    for (const text of ["two", "three", "four"]) {
      phone.setDoc(text);
      await phone.sync.sync();
      await desk.sync.sync({ quiet: true });
      expect(desk.doc).toBe(text);
    }
  });

  it("never overwrites what this device has typed", async () => {
    const { phone, desk } = await twoDevices("shared start");

    phone.setDoc("phone wins?");
    await phone.sync.sync();
    desk.setDoc("no, the desk was mid-sentence");

    await desk.sync.sync({ quiet: true });
    expect(desk.doc).toBe("no, the desk was mid-sentence");
    expect(desk.sync.status).toEqual({ kind: "conflict" });
  });

  it("stays quiet on the badge when polling", async () => {
    const { desk } = await twoDevices("shared start");

    desk.statuses.length = 0;
    await desk.sync.sync({ quiet: true });
    expect(desk.statuses).not.toContain("working");

    desk.statuses.length = 0;
    await desk.sync.sync();
    expect(desk.statuses).toContain("working");
  });
});
