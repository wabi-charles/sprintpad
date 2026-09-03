/**
 * Notifications are best-effort: permission is only requested once the user
 * has actually started a session, and every failure is silent.
 */
export function createNotifier(isEnabled: () => boolean) {
  const supported = typeof Notification !== "undefined";

  return {
    get permission(): NotificationPermission | "unsupported" {
      return supported ? Notification.permission : "unsupported";
    },

    /** Called when a session starts, so the prompt has obvious context. */
    async request(): Promise<void> {
      if (!supported || !isEnabled() || Notification.permission !== "default") return;
      try {
        await Notification.requestPermission();
      } catch {
        // Denied or unavailable; the in-app panel is still the source of truth.
      }
    },

    notify(title: string, body: string): void {
      if (!supported || !isEnabled() || Notification.permission !== "granted") return;
      try {
        new Notification(title, { body, tag: "sprintpad-focus" });
      } catch {
        // Some browsers reject construction outside a service worker.
      }
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
