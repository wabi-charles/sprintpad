import { createStore, forgetPadLocally, type StorageLike } from "../data/storage";
import { WrongPassword, decryptPad, derivePadKeys, encryptPad, randomSalt } from "./crypto";
import { SYNC_ENDPOINT } from "./endpoint";
import { createRemote } from "./remote";

/**
 * Making a new pad from the list you are looking at.
 *
 * The document is copied into the new pad rather than moved: the list you were
 * on is still there afterwards, whether that is the local one or another pad.
 */

export type CreateOutcome =
  | { kind: "created"; padId: string }
  | { kind: "taken" }
  | { kind: "failed"; detail: string };

export async function createPad(
  backend: StorageLike,
  padId: string,
  password: string,
  seedDoc: string,
): Promise<CreateOutcome> {
  const remote = createRemote(SYNC_ENDPOINT);

  try {
    // Refuse to write over a pad that already exists, even if we could: the
    // owner may simply need to open it instead.
    if (await remote.get(padId)) return { kind: "taken" };
  } catch (error) {
    return { kind: "failed", detail: error instanceof Error ? error.message : "Could not reach the server" };
  }

  const salt = randomSalt();
  const keys = await derivePadKeys(password, salt);

  try {
    const payload = await encryptPad(keys.encryption, salt, seedDoc);
    const updatedAt = await remote.put(padId, payload, null, keys.writeToken);

    const store = createStore(backend, padId);
    store.saveDoc(seedDoc);
    store.saveCredentials({ salt, password, lastSynced: { doc: seedDoc, updatedAt } });
    return { kind: "created", padId };
  } catch (error) {
    // Leave nothing half-made behind.
    forgetPadLocally(backend, padId);
    return { kind: "failed", detail: error instanceof Error ? error.message : "Could not create the pad" };
  }
}

export type OpenOutcome =
  | { kind: "opened" }
  | { kind: "missing" }
  | { kind: "wrongPassword" }
  | { kind: "failed"; detail: string };

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
): Promise<OpenOutcome> {
  let stored;
  try {
    stored = await createRemote(SYNC_ENDPOINT).get(padId);
  } catch (error) {
    return {
      kind: "failed",
      detail: error instanceof Error ? error.message : "Could not reach the server",
    };
  }
  if (!stored) return { kind: "missing" };

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
