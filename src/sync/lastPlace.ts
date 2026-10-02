import { browserStorage, knownPadIds, type StorageLike } from "../data/storage";

/**
 * Coming back to the list you were last on.
 *
 * The root of the site is the local list, and that is what the installed app
 * opens and what typing the bare address loads -- so after working in a pad,
 * every return dropped you back on a different list. Now a fresh entry picks
 * up where you left off.
 *
 * Two limits keep the root what it promised to be. Only a pad already open on
 * this device is resumed, so arriving never lands on a password prompt. And
 * choosing the local list on purpose is remembered too, so a reload after
 * doing that stays put rather than bouncing back into the pad.
 */

const KEY = "sprintpad.lastPlace";

/** Where the user is now: a pad by name, or null for the local list. */
export function rememberPlace(backend: StorageLike, padId: string | null): void {
  try {
    if (padId === null) backend.removeItem(KEY);
    else backend.setItem(KEY, padId);
  } catch {
    // Storage unavailable; the root simply stays the local list.
  }
}

/** The pad to reopen on a fresh entry, if it is still open on this device. */
export function placeToResume(backend: StorageLike): string | null {
  let padId: string | null;
  try {
    padId = backend.getItem(KEY);
  } catch {
    return null;
  }
  if (padId === null) return null;
  return knownPadIds(backend).includes(padId) ? padId : null;
}

/** Go to the local list deliberately, and have that stick. */
export function goLocal(backend: StorageLike = browserStorage(window.localStorage)): void {
  rememberPlace(backend, null);
  location.assign("/");
}
