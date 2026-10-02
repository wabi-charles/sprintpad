/**
 * Where pads are stored. A deployment detail, not a user setting: nobody
 * should have to know what a server is to use their task list on two devices.
 * Self-hosters point a build at their own with VITE_SYNC_ENDPOINT.
 */
export const SYNC_ENDPOINT =
  import.meta.env.VITE_SYNC_ENDPOINT ?? "https://sprintpad-sync.charles-564.workers.dev";
