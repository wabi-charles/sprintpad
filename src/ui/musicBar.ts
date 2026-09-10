import type { Music, MusicState } from "../focus/music";
import { STATIONS } from "../focus/stations";

/**
 * The player, as one line under the timer.
 *
 * Deliberately not a media player: no seeking, no track list, no artwork.
 * There is a station and there is silence, because the point of it is to stop
 * being looked at. Radio stations name where they came from, since SomaFM is
 * listener-supported and this is the least it is owed.
 */
export interface MusicBarHooks {
  music: Music;
  station(): string | null;
  choose(id: string | null): void;
}

export function createMusicBar(parent: HTMLElement, hooks: MusicBarHooks): HTMLElement {
  const root = document.createElement("div");
  root.className = "sp-music";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sp-music__toggle";

  const select = document.createElement("select");
  select.className = "sp-music__station";
  select.setAttribute("aria-label", "Focus sound");

  const silence = document.createElement("option");
  silence.value = "";
  silence.textContent = "No sound";
  select.append(silence);

  for (const station of STATIONS) {
    const option = document.createElement("option");
    option.value = station.id;
    option.textContent = station.name;
    option.title = station.note;
    select.append(option);
  }

  const note = document.createElement("a");
  note.className = "sp-music__note";
  note.target = "_blank";
  note.rel = "noopener noreferrer";

  root.append(toggle, select, note);
  parent.append(root);

  function paint(state: MusicState): void {
    const id = hooks.station();
    select.value = id ?? "";
    root.dataset.state = state.kind;

    const playing = state.kind === "playing" || state.kind === "loading";
    toggle.textContent = state.kind === "loading" ? "…" : playing ? "❚❚" : "▶";
    toggle.setAttribute("aria-label", playing ? "Stop the sound" : "Play the sound");
    toggle.disabled = id === null;

    if (state.kind === "error") {
      note.textContent = state.detail;
      note.removeAttribute("href");
      return;
    }

    const station = STATIONS.find((s) => s.id === id) ?? null;
    note.textContent = station?.note ?? "";
    if (station && station.kind === "radio") note.href = station.home;
    else note.removeAttribute("href");
  }

  toggle.addEventListener("click", () => {
    if (hooks.music.isPlaying) hooks.music.stop();
    else hooks.music.play(hooks.station());
  });

  select.addEventListener("change", () => {
    const id = select.value === "" ? null : select.value;
    hooks.choose(id);
    // Changing station while something is playing swaps it straight over;
    // otherwise choosing one is just choosing, not starting.
    if (id === null) hooks.music.stop();
    else if (hooks.music.isPlaying) hooks.music.play(id);
    paint(hooks.music.state);
  });

  hooks.music.onChange(paint);
  paint(hooks.music.state);
  return root;
}
