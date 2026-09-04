import { describe, expect, it } from "vitest";
import { reconcile, type SyncedState } from "./reconcile";

const agreed: SyncedState = { doc: "one", updatedAt: 1000 };

describe("reconcile", () => {
  it("uploads when creating a pad that does not exist yet", () => {
    expect(reconcile("one", null, null)).toEqual({ kind: "push" });
  });

  it("takes the remote when joining a pad that already has content", () => {
    expect(reconcile("local work", null, 1000)).toEqual({ kind: "pull" });
  });

  it("does nothing when both sides agree", () => {
    expect(reconcile("one", agreed, 1000)).toEqual({ kind: "idle" });
  });

  it("pushes when only this device changed", () => {
    expect(reconcile("one edited", agreed, 1000)).toEqual({ kind: "push" });
  });

  it("pulls when only the other device changed", () => {
    expect(reconcile("one", agreed, 2000)).toEqual({ kind: "pull" });
  });

  it("reports a conflict when both changed, rather than picking a winner", () => {
    expect(reconcile("one edited", agreed, 2000)).toEqual({ kind: "conflict" });
  });

  it("restores a pad that was deleted remotely instead of wiping the device", () => {
    expect(reconcile("one", agreed, null)).toEqual({ kind: "push" });
  });

  it("treats any change of stamp as a remote edit, including one that went back", () => {
    expect(reconcile("one", agreed, 500)).toEqual({ kind: "pull" });
  });
});
