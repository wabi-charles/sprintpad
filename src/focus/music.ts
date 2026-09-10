import { startSoundscape, type Soundscape } from "./soundscape";
import { parsePlaylist, stationById, type Station } from "./stations";

/**
 * The focus player.
 *
 * One control over two quite different things: an audio element pointed at
 * somebody else's server, and a few oscillators running here. The caller does
 * not care which -- it asks for a station and gets sound, or an error it can
 * put on screen.
 *
 * Nothing is requested, and no AudioContext is built, until play is pressed.
 * A browser will not start audio without a gesture anyway, and a task list
 * has no business opening a socket to a radio station on load.
 */

export type MusicState =
  | { kind: "off" }
  | { kind: "loading"; station: Station }
  | { kind: "playing"; station: Station }
  | { kind: "error"; station: Station; detail: string };

const FADE_SEC = 0.6;

export function createMusic(volume: () => number) {
  let state: MusicState = { kind: "off" };
  const listeners = new Set<(state: MusicState) => void>();

  let context: AudioContext | null = null;
  let gain: GainNode | null = null;
  let scape: Soundscape | null = null;
  let element: HTMLAudioElement | null = null;
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
      gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
    } catch {
      return null;
    }
    return context;
  }

  /** Ramped rather than set: a gain that jumps clicks. */
  function rampTo(target: number): void {
    if (!context || !gain) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + FADE_SEC);
  }

  function teardown(): void {
    generation += 1;
    scape?.stop();
    scape = null;
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
      element = null;
    }
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

    // A playlist names several servers because any one of them may be busy.
    for (const url of urls) {
      if (mine !== generation) return;
      const audio = new Audio();
      audio.preload = "auto";
      audio.crossOrigin = null;
      audio.volume = volume();
      audio.src = url;

      const ok = await new Promise<boolean>((resolve) => {
        const settle = (value: boolean): void => {
          audio.removeEventListener("playing", onPlaying);
          audio.removeEventListener("error", onError);
          resolve(value);
        };
        const onPlaying = (): void => settle(true);
        const onError = (): void => settle(false);
        audio.addEventListener("playing", onPlaying);
        audio.addEventListener("error", onError);
        audio.play().catch(() => settle(false));
        window.setTimeout(() => settle(false), 12_000);
      });

      if (mine !== generation) {
        audio.pause();
        return;
      }
      if (ok) {
        element = audio;
        announce({ kind: "playing", station });
        return;
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
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

    /** Play a station by id. Called from a gesture the first time. */
    play(id: string | null): void {
      const station = stationById(id);
      if (!station) return;

      teardown();
      const mine = generation;

      if (station.kind === "generated") {
        const ctx = audioContext();
        if (!ctx || !gain) {
          announce({ kind: "error", station, detail: "This browser has no audio" });
          return;
        }
        void ctx.resume();
        scape = startSoundscape(ctx, station.voice, gain);
        rampTo(volume());
        announce({ kind: "playing", station });
        return;
      }

      announce({ kind: "loading", station });
      void playRadio(station, mine);
    },

    stop(): void {
      rampTo(0);
      teardown();
      announce({ kind: "off" });
    },

    /** Called when the volume setting changes, mid-playback. */
    refreshVolume(): void {
      if (element) element.volume = volume();
      if (scape) rampTo(volume());
    },

    get isPlaying(): boolean {
      return state.kind === "playing" || state.kind === "loading";
    },
  };
}

export type Music = ReturnType<typeof createMusic>;
