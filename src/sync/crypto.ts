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

/**
 * Stretching the password takes a noticeable fraction of a second by design,
 * so the derived key is cached by the caller rather than re-derived per save.
 */
export async function deriveKey(password: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    utf8(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(salt), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
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
    super("That password does not open this pad.");
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
