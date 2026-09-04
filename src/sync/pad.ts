import type { PadCredentials, Store } from "../data/storage";
import {
  WrongPassword,
  decryptPad,
  derivePadKeys,
  encryptPad,
  randomSalt,
  type PadKeys,
} from "./crypto";
import { SYNC_ENDPOINT } from "./endpoint";
import { RemoteMovedOn, SyncUnavailable, WriteRefused, createRemote } from "./remote";
import { reconcile } from "./reconcile";

/**
 * Sync for the pad named by the URL.
 *
 * The root is never a pad: a plain load of the site is the local browser list,
 * and nothing here runs. `/happy` is the pad "happy", which needs its password
 * before it can be opened.
 */

export type SyncStatus =
  | { kind: "local" }
  | { kind: "locked" }
  | { kind: "working" }
  | { kind: "synced"; at: number }
  | { kind: "conflict" }
  | { kind: "error"; detail: string };

export interface PadSyncHooks {
  /** The pad the URL names, or null at the root. */
  padId: string | null;
  store: Store;
  getDoc(): string;
  applyRemote(doc: string): void;
  onStatus(status: SyncStatus): void;
}

export function createPadSync(hooks: PadSyncHooks) {
  const padId = hooks.padId;
  let credentials: PadCredentials | null = padId === null ? null : hooks.store.loadCredentials();
  let keys: PadKeys | null = null;
  let status: SyncStatus =
    padId === null ? { kind: "local" } : credentials === null ? { kind: "locked" } : { kind: "working" };
  let running = false;
  let again = false;

  function setStatus(next: SyncStatus): void {
    status = next;
    hooks.onStatus(next);
  }

  async function unlock(): Promise<PadKeys> {
    if (keys) return keys;
    if (!credentials) throw new SyncUnavailable("this pad is locked");
    keys = await derivePadKeys(credentials.password, credentials.salt);
    return keys;
  }

  async function runOnce(): Promise<void> {
    if (padId === null || !credentials) return;
    const remote = createRemote(SYNC_ENDPOINT);
    const derived = await unlock();

    const stored = await remote.get(padId);
    const localDoc = hooks.getDoc();
    const decision = reconcile(localDoc, credentials.lastSynced, stored?.updatedAt ?? null);

    if (decision.kind === "idle") {
      setStatus({ kind: "synced", at: credentials.lastSynced?.updatedAt ?? Date.now() });
      return;
    }
    if (decision.kind === "conflict") {
      setStatus({ kind: "conflict" });
      return;
    }

    if (decision.kind === "pull") {
      if (!stored) return;
      const doc = await decryptPad(derived.encryption, stored.payload);
      hooks.applyRemote(doc);
      credentials = { ...credentials, lastSynced: { doc, updatedAt: stored.updatedAt } };
      hooks.store.saveCredentials(credentials);
      setStatus({ kind: "synced", at: stored.updatedAt });
      return;
    }

    const payload = await encryptPad(derived.encryption, credentials.salt, localDoc);
    const updatedAt = await remote.put(padId, payload, stored?.updatedAt ?? null, derived.writeToken);
    credentials = { ...credentials, lastSynced: { doc: localDoc, updatedAt } };
    hooks.store.saveCredentials(credentials);
    setStatus({ kind: "synced", at: updatedAt });
  }

  async function sync(): Promise<void> {
    if (padId === null || !credentials) return;
    if (running) {
      again = true;
      return;
    }

    running = true;
    setStatus({ kind: "working" });
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } catch (error) {
      if (error instanceof WrongPassword) setStatus({ kind: "error", detail: "Wrong password" });
      else if (error instanceof WriteRefused) {
        // The pad exists and belongs to someone who knows a different password.
        setStatus({ kind: "error", detail: "That password does not open this pad" });
      } else if (error instanceof RemoteMovedOn) setStatus({ kind: "conflict" });
      else if (error instanceof SyncUnavailable) setStatus({ kind: "error", detail: error.message });
      else setStatus({ kind: "error", detail: "Sync failed" });
    } finally {
      running = false;
    }
  }

  return {
    get padId(): string | null {
      return padId;
    },

    /** True once this pad has been opened on this device. */
    get isUnlocked(): boolean {
      return padId !== null && credentials !== null;
    },

    get status(): SyncStatus {
      return status;
    },

    /**
     * Open the pad with a password.
     *
     * Nothing is stored until a sync actually succeeds, so a wrong password
     * leaves the browser exactly as it was rather than wedging every later
     * load in a state that needs repairing.
     */
    async unlockWith(password: string): Promise<void> {
      if (padId === null) return;
      const previous = credentials;

      credentials = { salt: randomSalt(), password, lastSynced: null };
      keys = null;

      // An existing pad's salt must be adopted, or the password derives a
      // different key and nothing it holds can be opened.
      try {
        const stored = await createRemote(SYNC_ENDPOINT).get(padId);
        if (stored) credentials = { ...credentials, salt: stored.payload.salt };
      } catch {
        // Offline; the sync below reports it and rolls back.
      }

      await sync();
      if (status.kind !== "synced") {
        credentials = previous;
        keys = null;
        hooks.store.saveCredentials(previous);
      }
    },

    /** Forget this pad's password on this device. */
    forget(): void {
      credentials = null;
      keys = null;
      hooks.store.saveCredentials(null);
      setStatus({ kind: "locked" });
    },

    async resolve(keep: "local" | "remote"): Promise<void> {
      if (padId === null || !credentials) return;
      const remote = createRemote(SYNC_ENDPOINT);
      const derived = await unlock();
      setStatus({ kind: "working" });

      try {
        const stored = await remote.get(padId);
        if (keep === "remote") {
          if (!stored) return;
          const doc = await decryptPad(derived.encryption, stored.payload);
          hooks.applyRemote(doc);
          credentials = { ...credentials, lastSynced: { doc, updatedAt: stored.updatedAt } };
        } else {
          const localDoc = hooks.getDoc();
          const payload = await encryptPad(derived.encryption, credentials.salt, localDoc);
          const updatedAt = await remote.put(padId, payload, null, derived.writeToken);
          credentials = { ...credentials, lastSynced: { doc: localDoc, updatedAt } };
        }
        hooks.store.saveCredentials(credentials);
        setStatus({ kind: "synced", at: credentials.lastSynced?.updatedAt ?? Date.now() });
      } catch (error) {
        setStatus({
          kind: "error",
          detail: error instanceof Error ? error.message : "Sync failed",
        });
      }
    },

    sync,
  };
}

export type PadSync = ReturnType<typeof createPadSync>;
