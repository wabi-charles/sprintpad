import { describe, expect, it } from "vitest";
import { describePasswordProblem, passwordProblem } from "./password";

describe("passwordProblem", () => {
  it("accepts a passphrase", () => {
    // Non-Latin scripts count the same; the rule is length, not alphabet.
    for (const ok of ["correct horse battery", "a-long-enough-one", "ᚠᚢᚦᚨᚱᚲ ᚷᚹᚺᚾᛁᛃ"]) {
      expect(passwordProblem(ok)).toBeNull();
    }
  });

  it("reports an empty password separately, since it is not a mistake", () => {
    expect(passwordProblem("")).toBe("empty");
  });

  it("rejects anything short, which is what offline attacks feed on", () => {
    expect(passwordProblem("hunter2")).toBe("short");
    expect(passwordProblem("elevenchars")).toBe("short");
    expect(passwordProblem("twelvechars!")).toBeNull();
  });

  it("rejects the obvious ones even at length", () => {
    expect(passwordProblem("password123")).toBe("short");
    expect(passwordProblem("password1234")).toBeNull();
    expect(passwordProblem("qwertyuiop")).toBe("short");
    expect(passwordProblem("123456789012")).toBe("obvious");
  });

  it("rejects length made of one repeated character", () => {
    expect(passwordProblem("aaaaaaaaaaaaaaa")).toBe("obvious");
    expect(passwordProblem("ababababababab")).toBe("obvious");
    expect(passwordProblem("abcabcabcabcabc")).toBeNull();
  });

  it("explains each case in words a person can act on", () => {
    for (const problem of ["empty", "short", "obvious"] as const) {
      const text = describePasswordProblem(problem);
      expect(text.length).toBeGreaterThan(20);
      expect(text).toMatch(/\.$/);
    }
  });
});
