/**
 * A pad's id is its address: sprintpad.app/happy. Memorable by design, which
 * also makes it guessable -- so writes are gated on a token derived from the
 * password (see derivePadKeys). Guessing an id gets you ciphertext you cannot
 * read and cannot overwrite.
 */

/** Paths the site itself serves, which cannot also be pads. */
const RESERVED = new Set([
  "assets",
  "sw.js",
  "registersw.js",
  "workbox",
  "manifest.webmanifest",
  "favicon.svg",
  "favicon-32.png",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "cname",
  "index.html",
  "404.html",
  "robots.txt",
  "pad",
  "api",
]);

const SHAPE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export type PadIdProblem = "empty" | "shape" | "reserved";

export function padIdProblem(raw: string): PadIdProblem | null {
  const id = raw.trim().toLowerCase();
  if (id === "") return "empty";
  if (!SHAPE.test(id) || id.includes("--")) return "shape";
  if (RESERVED.has(id) || id.startsWith("workbox-")) return "reserved";
  return null;
}

export function describePadIdProblem(problem: PadIdProblem): string {
  switch (problem) {
    case "empty":
      return "Choose a name for your pad.";
    case "reserved":
      return "That name is taken by the app itself. Try another.";
    default:
      return "Use 3–40 letters, numbers and single hyphens.";
  }
}

export function normalizePadId(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * The pad a URL points at. The root is deliberately not a pad: a plain load of
 * the site is always the local browser pad.
 */
export function padIdFromPath(pathname: string): string | null {
  const id = normalizePadId(decodeURIComponent(pathname.replace(/^\/+|\/+$/g, "")));
  if (id === "" || id.includes("/")) return null;
  return padIdProblem(id) === null ? id : null;
}

export function padUrl(padId: string): string {
  return `${location.origin}/${padId}`;
}
