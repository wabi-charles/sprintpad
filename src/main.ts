import "./styles.css";

/**
 * Which Sprintpad you get.
 *
 * The desktop app is a text editor: reordering with ⌘↑ and indenting with Tab
 * are the whole point of it, and neither key exists on a phone. Rather than
 * shrink that interface until it fits, a phone gets its own -- built for
 * thumbs, over the same document, storage and sync.
 *
 * The choice is made once, here, and the shell is fetched on demand: a phone
 * never downloads the editor, and a desktop never downloads the gestures.
 */

const OVERRIDE_KEY = "sprintpad.ui";
type Layout = "mobile" | "desktop";

function isLayout(value: string | null): value is Layout {
  return value === "mobile" || value === "desktop";
}

/**
 * A coarse pointer on a narrow screen is a phone. A tablet with a keyboard is
 * a real case and this will guess wrong for it, which is why the answer can be
 * overridden -- by `?ui=desktop` once, and from the menu for good.
 */
export function chooseLayout(search: string, stored: string | null): Layout {
  const asked = new URLSearchParams(search).get("ui");
  if (isLayout(asked)) return asked;
  if (isLayout(stored)) return stored;

  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return coarse && window.innerWidth < 900 ? "mobile" : "desktop";
}

let stored: string | null = null;
try {
  stored = window.localStorage.getItem(OVERRIDE_KEY);
} catch {
  // Storage unavailable; fall back to detection.
}

const layout = chooseLayout(window.location.search, stored);

// An answer given in the URL is meant to stick, or every link would undo it.
const asked = new URLSearchParams(window.location.search).get("ui");
if (isLayout(asked)) {
  try {
    window.localStorage.setItem(OVERRIDE_KEY, asked);
  } catch {
    // Storage unavailable; the parameter still applies to this load.
  }
}

document.documentElement.dataset.layout = layout;

if (layout === "mobile") {
  void import("./mobile/shell").then((module) => module.startMobile());
} else {
  void import("./desktop/shell").then((module) => module.startDesktop());
}
