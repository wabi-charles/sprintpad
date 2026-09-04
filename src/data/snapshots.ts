import { parseLine } from "../doc/grammar";

/**
 * Periodic copies of the document, so a destructive edit is recoverable after
 * the page reloads and takes the undo history with it.
 *
 * A snapshot records the document *before* a save, not after -- what you want
 * back is the state prior to whatever went wrong. They are spaced apart on
 * purpose: taking one per save would fill the buffer with the last few seconds
 * of typing, which recovers nothing.
 */

export interface Snapshot {
  /** Epoch ms when this state was superseded. */
  at: number;
  doc: string;
}

const LIMIT = 12;
const MIN_GAP_MS = 3 * 60 * 1000;

export interface RecordOptions {
  limit?: number;
  minGapMs?: number;
}

/** Returns the same array when nothing is worth recording. */
export function recordSnapshot(
  list: readonly Snapshot[],
  doc: string,
  now: number,
  { limit = LIMIT, minGapMs = MIN_GAP_MS }: RecordOptions = {},
): Snapshot[] {
  if (doc.trim() === "") return list as Snapshot[];

  const newest = list[list.length - 1];
  if (newest && newest.doc === doc) return list as Snapshot[];
  if (newest && now - newest.at < minGapMs) return list as Snapshot[];

  return [...list, { at: now, doc }].slice(-limit);
}

export interface SnapshotSummary {
  title: string;
  tasks: number;
}

/** Enough to recognise a version without opening it. */
export function describeSnapshot(doc: string): SnapshotSummary {
  let title = "";
  let tasks = 0;

  for (const raw of doc.split("\n")) {
    const line = parseLine(raw);
    if (line.kind === "task" && line.text.trim() !== "") {
      tasks += 1;
      if (title === "") title = line.text.trim();
    }
  }

  return { title: title === "" ? "Empty list" : title, tasks };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function formatAge(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "just now";

  const minutes = Math.floor(elapsed / MINUTE);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(elapsed / HOUR);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
