import { describe, expect, it } from "vitest";
import { parsePlaylist, stationById, STATIONS } from "./stations";

const PLS = `[playlist]
numberofentries=3
File1=https://ice2.somafm.com/groovesalad-256-mp3
Title1=SomaFM: Groove Salad (#1)
Length1=-1
File2=https://ice6.somafm.com/groovesalad-256-mp3
Title2=SomaFM: Groove Salad (#2)
Length2=-1
File3=https://ice5.somafm.com/groovesalad-256-mp3
Length3=-1
Version=2`;

describe("reading a station's playlist", () => {
  it("takes every server, in the order the station lists them", () => {
    // The order is the fallback order: one busy machine is not a broken feature.
    expect(parsePlaylist(PLS)).toEqual([
      "https://ice2.somafm.com/groovesalad-256-mp3",
      "https://ice6.somafm.com/groovesalad-256-mp3",
      "https://ice5.somafm.com/groovesalad-256-mp3",
    ]);
  });

  it("survives the line endings a server actually sends", () => {
    expect(parsePlaylist(PLS.replace(/\n/g, "\r\n"))).toHaveLength(3);
  });

  it("ignores the titles and the rest of the file", () => {
    expect(parsePlaylist(PLS).every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("refuses anything that is not http, whatever a playlist claims", () => {
    const hostile = "[playlist]\nFile1=javascript:alert(1)\nFile2=file:///etc/passwd\nFile3=data:audio/wav;base64,AA";
    expect(parsePlaylist(hostile)).toEqual([]);
  });

  it("comes back empty rather than throwing on nonsense", () => {
    expect(parsePlaylist("")).toEqual([]);
    expect(parsePlaylist("not a playlist at all")).toEqual([]);
  });
});

describe("the station list", () => {
  it("finds a station by id, and nothing by a bad one", () => {
    expect(stationById("brown")?.name).toBe("Brown noise");
    expect(stationById("nope")).toBeNull();
    expect(stationById(null)).toBeNull();
  });

  it("has unique ids, since they are what gets persisted", () => {
    const ids = STATIONS.map((station) => station.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers something that works with no network", () => {
    expect(STATIONS.some((station) => station.kind === "generated")).toBe(true);
  });

  it("credits every station it streams from somebody else", () => {
    for (const station of STATIONS) {
      if (station.kind !== "radio") continue;
      expect(station.home).toMatch(/^https:\/\//);
      expect(station.playlist).toMatch(/^https:\/\//);
    }
  });
});
