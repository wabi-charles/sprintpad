/**
 * Focus history is an append-only log keyed by task text. Deliberately not
 * per-task metadata in the document: keeping identity out of the text is what
 * lets the document stay a plain string (§21).
 */

export interface FocusRecord {
  id: string;
  taskText: string;
  /** Epoch ms. */
  startedAt: number;
  seconds: number;
  /** Whether the task was marked done at the end of this session. */
  completed: boolean;
}

export interface TodayTotals {
  rows: Array<{ taskText: string; seconds: number }>;
  totalSeconds: number;
}

const DEFAULT_LIMIT = 500;
/** Below this a session is a misfire, not work. */
const MIN_LOGGED_SECONDS = 30;

export function appendRecord(
  log: readonly FocusRecord[],
  record: FocusRecord,
  limit = DEFAULT_LIMIT,
): FocusRecord[] {
  if (record.seconds < MIN_LOGGED_SECONDS) return [...log];
  return [...log, record].slice(-limit);
}

function isSameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

export function todayTotals(log: readonly FocusRecord[], now: number): TodayTotals {
  const byTask = new Map<string, number>();
  let totalSeconds = 0;

  for (const entry of log) {
    if (!isSameLocalDay(entry.startedAt, now)) continue;
    byTask.set(entry.taskText, (byTask.get(entry.taskText) ?? 0) + entry.seconds);
    totalSeconds += entry.seconds;
  }

  const rows = [...byTask]
    .map(([taskText, seconds]) => ({ taskText, seconds }))
    .sort((a, b) => b.seconds - a.seconds || a.taskText.localeCompare(b.taskText));

  return { rows, totalSeconds };
}
