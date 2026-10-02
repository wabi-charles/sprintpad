/**
 * Adding, opening and deleting pads from the panel.
 *
 * This module had no tests, and it is the one place that writes a pad's local
 * document wholesale -- which is exactly where a mistyped password turned out
 * to be able to erase a list. The cases here are the ways someone can name a
 * pad, and what each must never do to a pad already on the device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, knownPadIds, type StorageLike } from "../data/storage";
import { fakeServer, memoryStorage, type FakeServer } from "./fakeServer.testing";
import { deletePadEverywhere, openOrCreatePad } from "./pads";

const PASSWORD = "correct horse battery staple";

let server: FakeServer;
let backend: StorageLike;

beforeEach(() => {
  server = fakeServer();
  vi.stubGlobal("fetch", server.handler);
  backend = memoryStorage();
});

afterEach(() => vi.unstubAllGlobals());

describe("naming a pad that is not on this device", () => {
  it("creates it from the list being looked at", async () => {
    const result = await openOrCreatePad(backend, "fresh", PASSWORD, "# TODAY\nShip it");

    expect(result.kind).toBe("created");
    expect(server.pads.has("fresh")).toBe(true);
    expect(createStore(backend, "fresh").loadDoc()).toBe("# TODAY\nShip it");
  });

  it("joins one that exists elsewhere, taking its document", async () => {
    await openOrCreatePad(memoryStorage(), "shared", PASSWORD, "made on the phone");

    const result = await openOrCreatePad(backend, "shared", PASSWORD, "the desk's own list");

    expect(result.kind).toBe("opened");
    expect(createStore(backend, "shared").loadDoc()).toBe("made on the phone");
  });

  it("leaves nothing behind when the password is wrong", async () => {
    await openOrCreatePad(memoryStorage(), "shared", PASSWORD, "made on the phone");

    const result = await openOrCreatePad(backend, "shared", "not the password at all", "x");

    expect(result.kind).toBe("wrongPassword");
    expect(knownPadIds(backend)).not.toContain("shared");
  });
});

/**
 * The cases that used to destroy work. A pad already on this device has its
 * own document and its own password stored; naming it again is a request to
 * go there, and must never rewrite what is here.
 */
describe("naming a pad that is already on this device", () => {
  async function padHere(doc: string): Promise<void> {
    const result = await openOrCreatePad(backend, "mine", PASSWORD, doc);
    expect(result.kind).toBe("created");
  }

  it("keeps the local list when the password is mistyped", async () => {
    await padHere("# TODAY\nThe only copy of this");

    await openOrCreatePad(backend, "mine", "a typo of the password", "x");

    const store = createStore(backend, "mine");
    expect(store.loadDoc()).toBe("# TODAY\nThe only copy of this");
    expect(store.loadCredentials()?.password).toBe(PASSWORD);
    expect(knownPadIds(backend)).toContain("mine");
  });

  it("does not overwrite edits that have not synced yet", async () => {
    await padHere("# TODAY\nShip it");
    // Typed here while offline: saved locally, never pushed.
    createStore(backend, "mine").saveDoc("# TODAY\nShip it\nWritten on the train");

    await openOrCreatePad(backend, "mine", PASSWORD, "x");

    expect(createStore(backend, "mine").loadDoc()).toBe("# TODAY\nShip it\nWritten on the train");
  });

  it("does not reseed it from whatever list is on screen after it was deleted elsewhere", async () => {
    await padHere("# TODAY\nThe pad's own tasks");
    server.deleteRemotely("mine");

    await openOrCreatePad(backend, "mine", PASSWORD, "# TODAY\nThe local list, a different thing");

    expect(createStore(backend, "mine").loadDoc()).toBe("# TODAY\nThe pad's own tasks");
  });

  it("says it is already here, so the panel can simply go to it", async () => {
    await padHere("anything");
    const result = await openOrCreatePad(backend, "mine", "whatever was typed", "x");
    expect(result.kind).toBe("alreadyHere");
  });

  it("does not touch the server to do so", async () => {
    await padHere("anything");
    server.handler.mockClear();

    await openOrCreatePad(backend, "mine", "whatever was typed", "x");

    expect(server.handler).not.toHaveBeenCalled();
  });
});

describe("deleting a pad everywhere", () => {
  it("removes it from the server and from this device", async () => {
    await openOrCreatePad(backend, "doomed", PASSWORD, "bye");

    const result = await deletePadEverywhere(backend, "doomed");

    expect(result.ok).toBe(true);
    expect(server.pads.has("doomed")).toBe(false);
    expect(knownPadIds(backend)).not.toContain("doomed");
  });

  it("refuses for a pad this device has not opened", async () => {
    const result = await deletePadEverywhere(backend, "never-seen");
    expect(result.ok).toBe(false);
  });
});
