import { createStore, forgetPadLocally, type StorageLike } from "../data/storage";
import { WrongPassword, decryptPad, derivePadKeys, encryptPad, randomSalt } from "./crypto";
import { SYNC_ENDPOINT } from "./endpoint";
import { WriteRefused, createRemote } from "./remote";

/**
 * Making a new pad from the list you are looking at.
 *
 * The document is copied into the new pad rather than moved: the list you were
 * on is still there afterwards, whether that is the local one or another pad.
 */

export type PadOutcome =
  | { kind: "opened" }
  | { kind: "created" }
  | { kind: "wrongPassword" }
  | { kind: "failed"; detail: string };

/**
 * Whether a pad is already out there. Used to tell the user which of the two
 * things the one button in front of them is about to do, before they press it.
 * Null when the answer is unknown -- offline, say -- which is not an error.
 */
export async function padExists(padId: string): Promise<boolean | null> {
  try {
    return (await createRemote(SYNC_ENDPOINT).get(padId)) !== null;
  } catch {
    return null;
  }
}

/**
 * A name and a password are all the user should have to think about. Whether
 * that means joining a pad or making one is a question the app can answer for
 * itself, so it does.
 */
export async function openOrCreatePad(
  backend: StorageLike,
  padId: string,
  password: string,
  seedDoc: string,
): Promise<PadOutcome> {
  const exists = await padExists(padId);
  if (exists === null) return { kind: "failed", detail: "Could not reach the server" };
  return exists
    ? openExistingPad(backend, padId, password)
    : createPad(backend, padId, password, seedDoc);
}

export async function createPad(
  backend: StorageLike,
  padId: string,
  password: string,
  seedDoc: string,
): Promise<PadOutcome> {
  const remote = createRemote(SYNC_ENDPOINT);
  const salt = randomSalt();
  const keys = await derivePadKeys(password, salt);

  try {
    const payload = await encryptPad(keys.encryption, salt, seedDoc);
    const updatedAt = await remote.put(padId, payload, null, keys.writeToken);

    const store = createStore(backend, padId);
    store.saveDoc(seedDoc);
    store.saveCredentials({ salt, password, lastSynced: { doc: seedDoc, updatedAt } });
    return { kind: "created" };
  } catch (error) {
    // Leave nothing half-made behind.
    forgetPadLocally(backend, padId);
    // Someone claimed the name between our check and our write.
    if (error instanceof WriteRefused) return { kind: "wrongPassword" };
    return { kind: "failed", detail: error instanceof Error ? error.message : "Could not create the pad" };
  }
}

/**
 * Adds a pad that already exists to this device.
 *
 * The counterpart to creating one, and the only way onto a second computer:
 * that device has never heard of the pad, so it cannot appear in a list until
 * someone names it.
 */
export async function openExistingPad(
  backend: StorageLike,
  padId: string,
  password: string,
): Promise<PadOutcome> {
  let stored;
  try {
    stored = await createRemote(SYNC_ENDPOINT).get(padId);
  } catch (error) {
    return {
      kind: "failed",
      detail: error instanceof Error ? error.message : "Could not reach the server",
    };
  }
  if (!stored) return { kind: "failed", detail: "That pad disappeared. Try again." };

  try {
    // The pad's own salt, or the password derives a key that opens nothing.
    const salt = stored.payload.salt;
    const keys = await derivePadKeys(password, salt);
    const doc = await decryptPad(keys.encryption, stored.payload);

    const store = createStore(backend, padId);
    store.saveDoc(doc);
    store.saveCredentials({ salt, password, lastSynced: { doc, updatedAt: stored.updatedAt } });
    return { kind: "opened" };
  } catch (error) {
    forgetPadLocally(backend, padId);
    if (error instanceof WrongPassword) return { kind: "wrongPassword" };
    return { kind: "failed", detail: error instanceof Error ? error.message : "Could not open the pad" };
  }
}

/** Deletes a pad for everyone. Needs the password, via its write token. */
export async function deletePadEverywhere(
  backend: StorageLike,
  padId: string,
): Promise<{ ok: boolean; detail?: string }> {
  const credentials = createStore(backend, padId).loadCredentials();
  if (!credentials) return { ok: false, detail: "This pad is not open on this device." };

  try {
    const keys = await derivePadKeys(credentials.password, credentials.salt);
    await createRemote(SYNC_ENDPOINT).remove(padId, keys.writeToken);
    forgetPadLocally(backend, padId);
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Could not delete the pad" };
  }
}
