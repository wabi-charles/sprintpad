import { describe, expect, it } from "vitest";
import { createStore } from "../data/storage";
import { memoryStorage } from "./fakeServer.testing";
import { placeToResume, rememberPlace } from "./lastPlace";

/** A pad counts as open here once its password is stored. */
function openPad(backend: ReturnType<typeof memoryStorage>, padId: string): void {
  createStore(backend, padId).saveCredentials({ salt: "s", password: "p", lastSynced: null });
}

describe("picking up where you left off", () => {
  it("resumes the pad you were last on", () => {
    const backend = memoryStorage();
    openPad(backend, "charles");
    rememberPlace(backend, "charles");
    expect(placeToResume(backend)).toBe("charles");
  });

  it("stays on the local list once you chose it", () => {
    const backend = memoryStorage();
    openPad(backend, "charles");
    rememberPlace(backend, "charles");
    rememberPlace(backend, null);
    expect(placeToResume(backend)).toBeNull();
  });

  it("does not resume a pad that is no longer on this device", () => {
    // Removed here, or never unlocked: resuming it would land on a password
    // prompt, and the root must never be that.
    const backend = memoryStorage();
    rememberPlace(backend, "gone");
    expect(placeToResume(backend)).toBeNull();
  });

  it("has nowhere to resume on a first visit", () => {
    expect(placeToResume(memoryStorage())).toBeNull();
  });

  it("survives storage that refuses to be read", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
      keys: () => [],
    };
    expect(() => rememberPlace(broken, "x")).not.toThrow();
    expect(placeToResume(broken)).toBeNull();
  });
});
