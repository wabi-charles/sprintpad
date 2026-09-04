/**
 * The pad is encrypted in the browser before it is ever sent anywhere.
 *
 * The password is not a credential the server checks -- it is the key. That is
 * what keeps the backend a dumb key-value store with no accounts, no password
 * hashes and no auth logic, and it means the server cannot read your tasks
 * even if it wanted to.
 *
 * The consequence, which cannot be softened: a forgotten password means the
 * remote copy is gone for good. There is nobody who can reset it.
 */

/** OWASP's floor for PBKDF2-HMAC-SHA256. Deliberately slow. */
const ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedPad {
  v: 1;
  /** Base64. Per-pad, so the same password on two pads derives two keys. */
  salt: string;
  /** Base64. Fresh for every write -- reusing one with AES-GCM is fatal. */
  iv: string;
  /** Base64 ciphertext, with GCM's authentication tag appended. */
  ct: string;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Backed by a plain ArrayBuffer so it satisfies BufferSource for WebCrypto.
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const bytes = new Uint8Array(new ArrayBuffer(encoded.length));
  bytes.set(encoded);
  return bytes;
}

export function randomSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/** A key id long enough that pads cannot be found by guessing. */
export function randomPadKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(18)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface PadKeys {
  /** Never leaves the browser. */
  encryption: CryptoKey;
  /**
   * Sent to the server, which stores it and demands it back on writes. It is
   * the other half of the derivation, so holding it reveals nothing about the
   * encryption key -- and reversing it to the password costs the same 310k
   * iterations as attacking the pad directly.
   *
   * Needed because a memorable pad id is a guessable one: without this,
   * anyone who guessed the id could overwrite the pad. They still could not
   * read it.
   */
  writeToken: string;
}

/**
 * One stretch of the password yields both halves: 32 bytes of encryption key
 * and 32 bytes of write token. Deliberately slow, so the caller caches it
 * rather than deriving per save.
 */
export async function derivePadKeys(password: string, salt: string): Promise<PadKeys> {
  const material = await crypto.subtle.importKey(
    "raw",
    utf8(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromBase64(salt), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    512,
  );

  const bytes = new Uint8Array(bits);
  const encryption = await crypto.subtle.importKey(
    "raw",
    bytes.slice(0, 32),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return { encryption, writeToken: toBase64(bytes.slice(32, 64)) };
}

export async function encryptPad(key: CryptoKey, salt: string, doc: string): Promise<EncryptedPad> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    utf8(doc),
  );
  return { v: 1, salt, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export class WrongPassword extends Error {
  constructor() {
    super("Wrong password.");
    this.name = "WrongPassword";
  }
}

/**
 * GCM authenticates as well as encrypts, so a wrong password and a tampered
 * payload both surface here rather than as quietly corrupt text.
 */
export async function decryptPad(key: CryptoKey, payload: EncryptedPad): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPassword();
  }
}

export function isEncryptedPad(value: unknown): value is EncryptedPad {
  if (typeof value !== "object" || value === null) return false;
  const pad = value as Partial<EncryptedPad>;
  return (
    pad.v === 1 &&
    typeof pad.salt === "string" &&
    typeof pad.iv === "string" &&
    typeof pad.ct === "string"
  );
}
