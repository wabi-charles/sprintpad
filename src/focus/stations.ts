/**
 * What there is to listen to.
 *
 * Two kinds, for one reason: a radio station is real music with real genres,
 * and it needs a network and somebody else's server. A generated one is a
 * handful of oscillators and works on a plane. Sprintpad is offline-capable and
 * sends nothing anywhere, so it would be wrong to make music the one thing
 * that only works when the wifi does.
 *
 * The stations are SomaFM's: listener-supported, no account, and they publish
 * their playlists for exactly this. Nothing is requested until you press play.
 */

export interface GeneratedStation {
  id: string;
  name: string;
  note: string;
  kind: "generated";
  voice: "brown" | "rain" | "drone";
}

export interface RadioStation {
  id: string;
  name: string;
  note: string;
  kind: "radio";
  /** Resolved when play is pressed: it names several servers, not one. */
  playlist: string;
  /** Where to credit it. */
  home: string;
}

export type Station = GeneratedStation | RadioStation;

export const STATIONS: readonly Station[] = [
  {
    id: "brown",
    name: "Brown noise",
    note: "Generated here — works offline",
    kind: "generated",
    voice: "brown",
  },
  {
    id: "rain",
    name: "Rain",
    note: "Generated here — works offline",
    kind: "generated",
    voice: "rain",
  },
  {
    id: "drone",
    name: "Drone",
    note: "Generated here — works offline",
    kind: "generated",
    voice: "drone",
  },
  {
    id: "groovesalad",
    name: "Groove Salad",
    note: "Ambient · downtempo — SomaFM",
    kind: "radio",
    playlist: "https://api.somafm.com/groovesalad256.pls",
    home: "https://somafm.com/groovesalad/",
  },
  {
    id: "dronezone",
    name: "Drone Zone",
    note: "Ambient — SomaFM",
    kind: "radio",
    playlist: "https://api.somafm.com/dronezone256.pls",
    home: "https://somafm.com/dronezone/",
  },
  {
    id: "fluid",
    name: "Fluid",
    note: "Instrumental hip-hop — SomaFM",
    kind: "radio",
    playlist: "https://api.somafm.com/fluid.pls",
    home: "https://somafm.com/fluid/",
  },
  {
    id: "lush",
    name: "Lush",
    note: "Vocal electronica — SomaFM",
    kind: "radio",
    playlist: "https://api.somafm.com/lush.pls",
    home: "https://somafm.com/lush/",
  },
];

export function stationById(id: string | null): Station | null {
  if (id === null) return null;
  return STATIONS.find((station) => station.id === id) ?? null;
}

/**
 * The stream URLs inside a `.pls`, in the order the station lists them.
 *
 * A playlist names several servers on purpose. Taking only the first would
 * mean one busy machine looks like a broken feature, so the player works down
 * the list. Anything that is not plain http(s) is dropped rather than handed
 * to an audio element.
 */
export function parsePlaylist(text: string): string[] {
  const urls: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*File\d+\s*=\s*(\S+)\s*$/i.exec(line);
    const url = match?.[1];
    if (url !== undefined && /^https?:\/\//i.test(url)) urls.push(url);
  }
  return urls;
}
