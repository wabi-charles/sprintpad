const BASE_TITLE = "Sprintpad";

/** §11: the remaining time follows you into other tabs. */
export function setTabTitle(prefix: string | null, task?: string): void {
  if (prefix === null) {
    document.title = BASE_TITLE;
    return;
  }
  document.title = task ? `${prefix} — ${task}` : `${prefix} — ${BASE_TITLE}`;
}
