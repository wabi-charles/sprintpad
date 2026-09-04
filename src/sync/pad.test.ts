/**
 * The wiring around sync, exercised against a fake server. This layer had no
 * coverage and is where a silent data loss would actually happen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StorageLike } from "../data/storage";
import { createPadSync } from "./pad";
import { SYNC_ENDPOINT } from "./endpoint";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** A stand-in for the Worker: the same contract, in memory. */
function fakeServer() {
  const pads = new Map<string, { payload: unknown; updatedAt: number }>();
  let clock = 1_000;

  const handler = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = url.pathname.replace("/pad/", "");
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if ((init?.method ?? "GET") === "GET") {
      const stored = pads.get(key);
      return stored ? json(stored) : json({ error: "not found" }, 404);
    }

    const prev = url.searchParams.get("prev");
    const current = pads.get(key);
    if (prev !== null && current && String(current.updatedAt) !== prev) {
      return json({ error: "conflict" }, 409);
    }
    const updatedAt = (clock += 1000);
    pads.set(key, { payload: JSON.parse(String(init?.body)), updatedAt });
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

function harness(initialDoc: string) {
  let doc = initialDoc;
  const store = createStore(memoryStorage());
  const applied: string[] = [];
  const sync = createPadSync({
    store,
    getDoc: () => doc,
    applyRemote: (next) => {
      doc = next;
      applied.push(next);
    },
    onStatus: () => {},
  });
  return { sync, store, applied, get doc() { return doc; }, setDoc: (v: string) => (doc = v) };
}

describe("turning sync on", () => {
  it("is off until connected, and touches no network", async () => {
    const { sync, store } = harness("one");
    expect(sync.isOn).toBe(false);
    await sync.sync();
    expect(server.handler).not.toHaveBeenCalled();
    expect(store.loadSync()).toBeNull();
  });

  it("creates a pad and uploads what is here", async () => {
    const { sync, store } = harness("# TODAY\nShip it");
    await sync.connect("", "hunter2");

    expect(sync.isOn).toBe(true);
    expect(sync.status).toMatchObject({ kind: "synced" });
    expect(store.loadSync()?.padKey).toBe(sync.padKey);
    expect(server.pads.size).toBe(1);
  });

  it("stores ciphertext, never the document", async () => {
    const { sync } = harness("# TODAY\nPay taxes");
    await sync.connect("", "hunter2");
    expect(JSON.stringify([...server.pads.values()])).not.toContain("Pay taxes");
  });

  it("uses the configured endpoint rather than asking for one", async () => {
    const { sync } = harness("one");
    await sync.connect("", "pw");
    expect(String(server.handler.mock.calls[0]?.[0])).toContain(SYNC_ENDPOINT);
  });
});

describe("a second device", () => {
  it("joins by pad key and password, and takes the pad", async () => {
    const first = harness("# TODAY\nFrom device A");
    await first.sync.connect("", "hunter2");
    const padKey = first.sync.padKey!;

    const second = harness("# TODAY\nUntouched starter");
    await second.sync.connect(padKey, "hunter2");

    expect(second.doc).toBe("# TODAY\nFrom device A");
    expect(second.applied).toHaveLength(1);
  });

  it("refuses the wrong password and leaves the document alone", async () => {
    const first = harness("# TODAY\nSecret");
    await first.sync.connect("", "right");

    const second = harness("# TODAY\nMine");
    await second.sync.connect(first.sync.padKey!, "wrong");

    expect(second.sync.status).toMatchObject({ kind: "error", detail: "Wrong password" });
    expect(second.doc).toBe("# TODAY\nMine");
  });
});

describe("keeping in step", () => {
  it("pushes a local edit", async () => {
    const { sync, setDoc } = harness("one");
    await sync.connect("", "pw");
    const before = server.pads.get(sync.padKey!)!.updatedAt;

    setDoc("one edited");
    await sync.sync();
    expect(server.pads.get(sync.padKey!)!.updatedAt).toBeGreaterThan(before);
  });

  it("does nothing when neither side moved", async () => {
    const { sync } = harness("one");
    await sync.connect("", "pw");
    const calls = server.handler.mock.calls.length;
    await sync.sync();
    // One read to check, and no write.
    expect(server.handler.mock.calls.length).toBe(calls + 1);
  });

  it("reports a conflict when both sides moved, rather than picking one", async () => {
    const { sync, setDoc, doc } = harness("one");
    await sync.connect("", "pw");

    setDoc("changed here");
    server.editRemotely(sync.padKey!);
    await sync.sync();

    expect(sync.status).toEqual({ kind: "conflict" });
    expect(doc).toBe("one");
  });

  it("resolves a conflict by keeping this device", async () => {
    const { sync, setDoc } = harness("one");
    await sync.connect("", "pw");
    setDoc("changed here");
    server.editRemotely(sync.padKey!);
    await sync.sync();

    await sync.resolve("local");
    expect(sync.status).toMatchObject({ kind: "synced" });
  });
});

describe("when the network is down", () => {
  it("surfaces the failure and keeps the document", async () => {
    const { sync, doc } = harness("one");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await sync.connect("", "pw");

    expect(sync.status).toMatchObject({ kind: "error" });
    expect(doc).toBe("one");
  });
});

describe("turning sync off", () => {
  it("forgets the pad and stops syncing", async () => {
    const { sync, store } = harness("one");
    await sync.connect("", "pw");
    sync.disconnect();

    expect(sync.isOn).toBe(false);
    expect(store.loadSync()).toBeNull();
    const calls = server.handler.mock.calls.length;
    await sync.sync();
    expect(server.handler.mock.calls.length).toBe(calls);
  });
});
