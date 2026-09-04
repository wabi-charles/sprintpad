/**
 * A short two-note chime when a session ends.
 *
 * Notifications need permission, are easy to miss, and are silently dead if
 * denied -- which matters most in the mode where you are meant to be looking
 * away from the screen. Synthesised rather than loaded so there is no asset,
 * and no request, to depend on.
 */
export function createChime(isEnabled: () => boolean) {
  let context: AudioContext | null = null;

  function ensureContext(): AudioContext | null {
    if (context) return context;
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
    return context;
  }

  function note(ctx: AudioContext, hz: number, startAt: number, seconds: number): void {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = hz;

    // Shaped rather than switched, so it reads as a chime and not a click.
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.18, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + seconds);
  }

  return {
    /**
     * Called while a keystroke is still being handled: browsers only allow an
     * AudioContext to start from a gesture, so it is created when the user
     * starts a session rather than when the timer eventually ends.
     */
    prepare(): void {
      const ctx = ensureContext();
      if (ctx?.state === "suspended") void ctx.resume();
    },

    play(): void {
      if (!isEnabled()) return;
      const ctx = ensureContext();
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume();

      const start = ctx.currentTime + 0.01;
      note(ctx, 660, start, 0.28);
      note(ctx, 880, start + 0.16, 0.42);
    },
  };
}

export type Chime = ReturnType<typeof createChime>;
