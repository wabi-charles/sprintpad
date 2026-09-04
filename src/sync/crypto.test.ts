import { describe, expect, it } from "vitest";
import {
  WrongPassword,
  decryptPad,
  deriveKey,
  encryptPad,
  isEncryptedPad,
  randomPadKey,
  randomSalt,
} from "./crypto";

const DOC = "# TODAY\nShip the thing\n[x] Pay taxes";

describe("encrypting a pad", () => {
  it("round-trips the document", async () => {
    const salt = randomSalt();
    const key = await deriveKey("correct horse", salt);
    expect(await decryptPad(key, await encryptPad(key, salt, DOC))).toBe(DOC);
  });

  it("round-trips an empty document and unicode", async () => {
    const salt = randomSalt();
    const key = await deriveKey("pw", salt);
    for (const text of ["", "☐ ⌘↑ — café 🎯"]) {
      expect(await decryptPad(key, await encryptPad(key, salt, text))).toBe(text);
    }
  });

  it("rejects the wrong password", async () => {
    const salt = randomSalt();
    const payload = await encryptPad(await deriveKey("right", salt), salt, DOC);
    const wrong = await deriveKey("wrong", salt);
    await expect(decryptPad(wrong, payload)).rejects.toBeInstanceOf(WrongPassword);
  });

  it("detects a tampered payload rather than returning corrupt text", async () => {
    const salt = randomSalt();
    const key = await deriveKey("pw", salt);
    const payload = await encryptPad(key, salt, DOC);
    const flipped = { ...payload, ct: `A${payload.ct.slice(1)}` };
    await expect(decryptPad(key, flipped)).rejects.toBeInstanceOf(WrongPassword);
  });

  it("never reuses an IV, which would be fatal for AES-GCM", async () => {
    const salt = randomSalt();
    const key = await deriveKey("pw", salt);
    const ivs = new Set<string>();
    for (let i = 0; i < 8; i++) ivs.add((await encryptPad(key, salt, DOC)).iv);
    expect(ivs.size).toBe(8);
  });

  it("does not leak the document into the payload", async () => {
    const salt = randomSalt();
    const key = await deriveKey("pw", salt);
    const payload = await encryptPad(key, salt, DOC);
    expect(JSON.stringify(payload)).not.toContain("Ship the thing");
  });

  it("gives the same password different keys on different pads", async () => {
    const a = randomSalt();
    const b = randomSalt();
    const payload = await encryptPad(await deriveKey("pw", a), a, DOC);
    await expect(decryptPad(await deriveKey("pw", b), payload)).rejects.toBeInstanceOf(
      WrongPassword,
    );
  });
});

describe("identifiers", () => {
  it("mints URL-safe pad keys that do not collide", () => {
    const keys = new Set(Array.from({ length: 50 }, randomPadKey));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it("mints a fresh salt each time", () => {
    expect(randomSalt()).not.toBe(randomSalt());
  });
});

describe("isEncryptedPad", () => {
  it("accepts a payload and rejects anything else", async () => {
    const salt = randomSalt();
    expect(isEncryptedPad(await encryptPad(await deriveKey("pw", salt), salt, DOC))).toBe(true);
    for (const bad of [null, 42, {}, { v: 2, salt: "a", iv: "b", ct: "c" }, { v: 1, salt: "a" }]) {
      expect(isEncryptedPad(bad)).toBe(false);
    }
  });
});
