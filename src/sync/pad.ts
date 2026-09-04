import type { Store, SyncConfig } from "../data/storage";
import { WrongPassword, decryptPad, deriveKey, encryptPad, randomPadKey, randomSalt } from "./crypto";
import { SYNC_ENDPOINT } from "./endpoint";
import { RemoteMovedOn, SyncUnavailable, createRemote } from "./remote";
import { reconcile } from "./reconcile";

/**
 * Sync, switched off unless the user turns it on. Everything here is a no-op
 * while `config` is null, which is the default: the pad lives in this browser
 * and nothing leaves it.
 */

export type SyncStatus =
  | { kind: "off" }
  | { kind: "working" }
  | { kind: "synced"; at: number }
  | { kind: "conflict" }
  | { kind: "error"; detail: string };

export interface PadSyncHooks {
  store: Store;
  /** The document as it stands right now. */
  getDoc(): string;
  /** Replace the document with what the other device has. */
  applyRemote(doc: string): void;
  onStatus(status: SyncStatus): void;
}

export function createPadSync(hooks: PadSyncHooks) {
  let config: SyncConfig | null = hooks.store.loadSync();
  let key: CryptoKey | null = null;
  let status: SyncStatus = { kind: "off" };
  let running = false;
  /** Set when a sync is asked for while one is already in flight. */
  let again = false;

  function setStatus(next: SyncStatus): void {
    status = next;
    hooks.onStatus(next);
  }

  function persist(): void {
    hooks.store.saveSync(config);
  }

  async function unlock(): Promise<CryptoKey> {
    if (key) return key;
    if (!config) throw new SyncUnavailable("sync is off");
    key = await deriveKey(config.password, config.salt);
    return key;
  }

  async function runOnce(): Promise<void> {
    if (!config) return;
    const remote = createRemote(SYNC_ENDPOINT);
    const derived = await unlock();

    const stored = await remote.get(config.padKey);
    const localDoc = hooks.getDoc();
    const decision = reconcile(localDoc, config.lastSynced, stored?.updatedAt ?? null);

    if (decision.kind === "idle") {
      setStatus({ kind: "synced", at: config.lastSynced?.updatedAt ?? Date.now() });
      return;
    }

    if (decision.kind === "conflict") {
      setStatus({ kind: "conflict" });
      return;
    }

    if (decision.kind === "pull") {
      if (!stored) return;
      const doc = await decryptPad(derived, stored.payload);
      hooks.applyRemote(doc);
      config = { ...config, lastSynced: { doc, updatedAt: stored.updatedAt } };
      persist();
      setStatus({ kind: "synced", at: stored.updatedAt });
      return;
    }

    const payload = await encryptPad(derived, config.salt, localDoc);
    const updatedAt = await remote.put(config.padKey, payload, stored?.updatedAt ?? null);
    config = { ...config, lastSynced: { doc: localDoc, updatedAt } };
    persist();
    setStatus({ kind: "synced", at: updatedAt });
  }

  async function sync(): Promise<void> {
    if (!config) return;
    // Coalesce: a save during a sync queues one more pass rather than racing.
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
      else if (error instanceof RemoteMovedOn) setStatus({ kind: "conflict" });
      else if (error instanceof SyncUnavailable) setStatus({ kind: "error", detail: error.message });
      else setStatus({ kind: "error", detail: "Sync failed" });
    } finally {
      running = false;
    }
  }

  return {
    get isOn(): boolean {
      return config !== null;
    },

    get status(): SyncStatus {
      return status;
    },

    get padKey(): string | null {
      return config?.padKey ?? null;
    },

    /**
     * Connect to a pad, creating a key when none is given.
     *
     * Nothing is written until a sync actually succeeds. A wrong password or
     * an unreachable server used to leave a config behind, which meant every
     * later visit -- including a plain load of the site with no link -- came
     * up in a broken sync state asking to be repaired. Failing here leaves the
     * browser exactly as it was: local, with no password anywhere in sight.
     */
    async connect(padKey: string, password: string): Promise<void> {
      const previous = config;

      config = {
        padKey: padKey.trim() === "" ? randomPadKey() : padKey.trim(),
        salt: randomSalt(),
        password,
        lastSynced: null,
      };
      key = null;

      // Joining an existing pad: adopt its salt, or the password derives the
      // wrong key and nothing it holds can be opened.
      try {
        const stored = await createRemote(SYNC_ENDPOINT).get(config.padKey);
        if (stored) config = { ...config, salt: stored.payload.salt };
      } catch {
        // Offline at setup; the sync below will report it and roll back.
      }

      // A successful pass persists on its own; anything else rolls back and
      // leaves the failure on screen so it is clear why.
      await sync();
      if (status.kind !== "synced") {
        config = previous;
        key = null;
        persist();
      }
    },

    disconnect(): void {
      config = null;
      key = null;
      persist();
      setStatus({ kind: "off" });
    },

    /** Resolve a conflict by choosing a side; both are recoverable afterwards. */
    async resolve(keep: "local" | "remote"): Promise<void> {
      if (!config) return;
      const remote = createRemote(SYNC_ENDPOINT);
      const derived = await unlock();
      setStatus({ kind: "working" });

      try {
        const stored = await remote.get(config.padKey);
        if (keep === "remote") {
          if (!stored) return;
          const doc = await decryptPad(derived, stored.payload);
          hooks.applyRemote(doc);
          config = { ...config, lastSynced: { doc, updatedAt: stored.updatedAt } };
        } else {
          const localDoc = hooks.getDoc();
          const payload = await encryptPad(derived, config.salt, localDoc);
          const updatedAt = await remote.put(config.padKey, payload, null);
          config = { ...config, lastSynced: { doc: localDoc, updatedAt } };
        }
        persist();
        setStatus({ kind: "synced", at: config.lastSynced?.updatedAt ?? Date.now() });
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
