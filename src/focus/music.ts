import { startSoundscape, type Soundscape } from "./soundscape";
import { parsePlaylist, stationById, type Station } from "./stations";

/**
 * The focus player.
 *
 * One control over two quite different things: an audio element pointed at
 * somebody else's server, and a few oscillators running here. The caller does
 * not care which -- it asks for a station and gets sound, or a state it can
 * put on screen.
 *
 * Nothing is requested, and no AudioContext is built, until there is a reason
 * to. A task list has no business opening a socket to a radio station on load.
 *
 * The awkward part is permission. Browsers only let audio start inside a tap
 * or a keystroke, and iOS is strictest: the AudioContext has to be resumed and
 * the media element played *during* the gesture, not in a timer afterwards.
 * Sessions start on a gesture but the music follows on the next clock tick, so
 * `unlock()` exists to do the permission-sensitive part in the gesture itself
 * and leave the rest to whenever it happens. When that is not possible -- a
 * reload mid-session, with nobody's finger involved -- the player says so
 * rather than claiming to play into silence.
 */

export type MusicState =
  | { kind: "off" }
  | { kind: "loading"; station: Station }
  | { kind: "playing"; station: Station }
  /** The browser will not start audio until someone taps play. */
  | { kind: "blocked"; station: Station }
  | { kind: "error"; station: Station; detail: string };

const FADE_SEC = 0.6;

/**
 * Ten milliseconds of silence. Played once inside a gesture, it marks the media
 * element as allowed to play -- which on iOS is a property of the element, so
 * the same element is reused for every stream afterwards.
 */
const SILENCE =
  "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

/** How long a generated station gets to prove the context really started. */
const START_CHECK_MS = 400;

interface Voice {
  scape: Soundscape;
  /** Each voice fades on its own, so switching stations crossfades. */
  fade: GainNode;
}

export function createMusic(volume: () => number) {
  let state: MusicState = { kind: "off" };
  const listeners = new Set<(state: MusicState) => void>();

  let context: AudioContext | null = null;
  /** The volume, and nothing else: fades happen per voice. */
  let master: GainNode | null = null;
  let voice: Voice | null = null;
  let element: HTMLAudioElement | null = null;
  let blessed = false;
  /** Guards against a slow playlist fetch landing after a later stop. */
  let generation = 0;

  function announce(next: MusicState): void {
    state = next;
    listeners.forEach((listen) => listen(state));
  }

  function audioContext(): AudioContext | null {
    if (context) return context;
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = volume();
      master.connect(context.destination);
    } catch {
      return null;
    }
    return context;
  }

  function mediaElement(): HTMLAudioElement {
    if (!element) {
      element = new Audio();
      element.preload = "none";
    }
    return element;
  }

  /** Fade a voice out, and only then stop it -- stopping first is a click. */
  function release(ending: Voice): void {
    if (context) {
      const now = context.currentTime;
      ending.fade.gain.cancelScheduledValues(now);
      ending.fade.gain.setValueAtTime(ending.fade.gain.value, now);
      ending.fade.gain.linearRampToValueAtTime(0, now + FADE_SEC);
    }
    window.setTimeout(() => {
      ending.scape.stop();
      ending.fade.disconnect();
    }, FADE_SEC * 1000 + 50);
  }

  function teardown(): void {
    generation += 1;
    if (voice) {
      release(voice);
      voice = null;
    }
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
  }

  function playGenerated(station: Station & { kind: "generated" }, mine: number): void {
    const ctx = audioContext();
    if (!ctx || !master) {
      announce({ kind: "error", station, detail: "This browser has no audio" });
      return;
    }
    if (ctx.state !== "running") void ctx.resume().catch(() => {});

    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.connect(master);
    const now = ctx.currentTime;
    fade.gain.setValueAtTime(0, now);
    fade.gain.linearRampToValueAtTime(1, now + FADE_SEC);
    voice = { scape: startSoundscape(ctx, station.voice, fade), fade };
    announce({ kind: "playing", station });

    // A suspended context accepts all of the above and plays nothing. Check,
    // rather than leave a pause button over silence.
    window.setTimeout(() => {
      if (mine === generation && ctx.state !== "running") announce({ kind: "blocked", station });
    }, START_CHECK_MS);
  }

  async function playRadio(station: Station & { kind: "radio" }, mine: number): Promise<void> {
    let urls: string[];
    try {
      const response = await fetch(station.playlist, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      urls = parsePlaylist(await response.text());
    } catch {
      if (mine === generation) {
        announce({ kind: "error", station, detail: "Could not reach the station" });
      }
      return;
    }
    if (mine !== generation) return;
    if (urls.length === 0) {
      announce({ kind: "error", station, detail: "The station listed no streams" });
      return;
    }

    const audio = mediaElement();
    audio.volume = volume();

    // A playlist names several servers because any one of them may be busy.
    for (const url of urls) {
      if (mine !== generation) return;
      audio.src = url;

      const outcome = await new Promise<"playing" | "failed" | "blocked">((resolve) => {
        let settled = false;
        const settle = (value: "playing" | "failed" | "blocked"): void => {
          if (settled) return;
          settled = true;
          audio.removeEventListener("playing", onPlaying);
          audio.removeEventListener("error", onError);
          resolve(value);
        };
        const onPlaying = (): void => settle("playing");
        const onError = (): void => settle("failed");
        audio.addEventListener("playing", onPlaying);
        audio.addEventListener("error", onError);
        // Refused permission is not a dead server, and must not be reported
        // as one: trying the next server would only be refused again.
        audio
          .play()
          .catch((error: unknown) =>
            settle(error instanceof DOMException && error.name === "NotAllowedError" ? "blocked" : "failed"),
          );
        window.setTimeout(() => settle("failed"), 12_000);
      });

      if (mine !== generation) return;
      if (outcome === "playing") {
        announce({ kind: "playing", station });
        return;
      }
      if (outcome === "blocked") {
        announce({ kind: "blocked", station });
        return;
      }
    }

    announce({
      kind: "error",
      station,
      detail: "No stream would play. The station may be down.",
    });
  }

  return {
    get state(): MusicState {
      return state;
    },

    onChange(listen: (state: MusicState) => void): void {
      listeners.add(listen);
    },

    /**
     * The permission-sensitive part, for calling inside a tap or keystroke.
     * Cheap and idempotent: once the context runs and the element is blessed,
     * it does nothing.
     */
    unlock(): void {
      const ctx = audioContext();
      if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});

      if (blessed) return;
      const media = mediaElement();
      media.src = SILENCE;
      blessed = true;
      const attempt = media.play();
      attempt
        ?.then(() => {
          // Only stop the silence if nothing real has replaced it since.
          if (media.src === SILENCE) media.pause();
        })
        .catch((error: unknown) => {
          // Aborted by a real stream taking over still counts: the call was
          // made inside the gesture, which is all the browser was checking.
          if (error instanceof DOMException && error.name === "NotAllowedError") blessed = false;
        });
    },

    /** Play a station by id. */
    play(id: string | null): void {
      const station = stationById(id);
      if (!station) return;

      teardown();
      const mine = generation;

      if (station.kind === "generated") {
        playGenerated(station, mine);
        return;
      }

      announce({ kind: "loading", station });
      void playRadio(station, mine);
    },

    stop(): void {
      teardown();
      announce({ kind: "off" });
    },

    /** Called when the volume setting changes, mid-playback. */
    refreshVolume(): void {
      if (element) element.volume = volume();
      if (context && master) {
        const now = context.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(volume(), now + FADE_SEC);
      }
    },

    /** Something is sounding, or about to. Blocked is neither. */
    get isPlaying(): boolean {
      return state.kind === "playing" || state.kind === "loading";
    },
  };
}

export type Music = ReturnType<typeof createMusic>;
