/**
 * Where pads are stored. A deployment detail, not a user setting: nobody
 * should have to know what a server is to use their task list on two devices.
 * Self-hosters point a build at their own with VITE_SYNC_ENDPOINT.
 */
export const SYNC_ENDPOINT =
  import.meta.env.VITE_SYNC_ENDPOINT ?? "https://sprintpad-sync.charles-564.workers.dev";

/** The fragment that carries a pad into another browser. */
export const PAD_LINK_PARAM = "pad";

export function padLink(padKey: string): string {
  return `${location.origin}/#${PAD_LINK_PARAM}=${encodeURIComponent(padKey)}`;
}

/** A pad key handed over in the URL, if there is one. */
export function padKeyFromLocation(hash: string): string | null {
  const match = new RegExp(`[#&]${PAD_LINK_PARAM}=([A-Za-z0-9_-]{8,64})`).exec(hash);
  return match?.[1] ?? null;
}
