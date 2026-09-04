/**
 * What to do when the local pad and the remote one disagree.
 *
 * Kept pure and separate from the network so the awkward cases -- two devices
 * edited, a device joins a pad that already exists -- can be reasoned about
 * and tested rather than discovered in use.
 */

export interface SyncedState {
  /** The document as it stood the last time both sides agreed. */
  doc: string;
  /** The remote's stamp at that moment. */
  updatedAt: number;
}

export type SyncDecision =
  | { kind: "idle" }
  | { kind: "push" }
  | { kind: "pull" }
  | { kind: "conflict" };

export function reconcile(
  localDoc: string,
  lastSynced: SyncedState | null,
  remoteUpdatedAt: number | null,
): SyncDecision {
  // First contact with this pad.
  if (lastSynced === null) {
    // Joining a pad that already has content: take it, having kept a snapshot
    // of what was here. Creating it: upload what we have.
    return remoteUpdatedAt === null ? { kind: "push" } : { kind: "pull" };
  }

  // The pad was deleted remotely; put ours back rather than wiping the device.
  if (remoteUpdatedAt === null) return { kind: "push" };

  const localChanged = localDoc !== lastSynced.doc;
  const remoteChanged = remoteUpdatedAt !== lastSynced.updatedAt;

  if (localChanged && remoteChanged) return { kind: "conflict" };
  if (localChanged) return { kind: "push" };
  if (remoteChanged) return { kind: "pull" };
  return { kind: "idle" };
}
