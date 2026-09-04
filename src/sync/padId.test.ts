/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { padIdFromPath, padIdProblem, padUrl } from "./padId";

describe("padIdProblem", () => {
  it("accepts memorable names", () => {
    for (const id of ["happy", "work-2026", "charles", "a1b", "x".repeat(40)]) {
      expect(padIdProblem(id)).toBeNull();
    }
  });

  it("rejects names that are too short or too long", () => {
    expect(padIdProblem("ab")).toBe("shape");
    expect(padIdProblem("x".repeat(41))).toBe("shape");
  });

  it("rejects anything that would not survive a URL", () => {
    for (const id of ["has space", "Slash/es", "emoji🎯", "-leading", "trailing-", "dou--ble"]) {
      expect(padIdProblem(id)).toBe("shape");
    }
  });

  it("refuses names the site itself serves", () => {
    for (const id of ["assets", "pad", "api", "cname", "workbox-abc123"]) {
      expect(padIdProblem(id)).toBe("reserved");
    }
  });

  it("rejects the app's own filenames on shape, before reserved even matters", () => {
    // They carry dots, which a pad name may not.
    for (const id of ["sw.js", "manifest.webmanifest", "icon-512.png"]) {
      expect(padIdProblem(id)).toBe("shape");
    }
  });

  it("treats a name as its lowercase form", () => {
    expect(padIdProblem("Happy")).toBeNull();
  });

  it("reports an empty name separately, since it is not a mistake", () => {
    expect(padIdProblem("   ")).toBe("empty");
  });
});

describe("padIdFromPath", () => {
  it("reads the pad from a path", () => {
    expect(padIdFromPath("/happy")).toBe("happy");
    expect(padIdFromPath("/happy/")).toBe("happy");
    expect(padIdFromPath("/Happy")).toBe("happy");
  });

  it("treats the root as no pad at all", () => {
    expect(padIdFromPath("/")).toBeNull();
    expect(padIdFromPath("")).toBeNull();
  });

  it("ignores paths the app serves rather than treating them as pads", () => {
    expect(padIdFromPath("/sw.js")).toBeNull();
    expect(padIdFromPath("/assets")).toBeNull();
  });

  it("ignores nested paths", () => {
    expect(padIdFromPath("/happy/extra")).toBeNull();
  });
});

describe("padUrl", () => {
  it("is the address you would send someone", () => {
    expect(padUrl("happy")).toBe(`${location.origin}/happy`);
  });
});
