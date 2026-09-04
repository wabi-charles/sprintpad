/**
 * Links, without leaving plain text behind.
 *
 * A pasted URL stays in the document exactly as pasted -- copy, export and
 * sync all still hand back the real address. Only the *painting* changes: the
 * URL is drawn short and clickable, the way Slack and Notion draw one, so a
 * long address cannot swamp the task it belongs to.
 *
 * There is no title to show, because Sprintpad fetches nothing. The honest
 * short form is therefore the host plus as much of the path as fits.
 */

/**
 * Deliberately narrow: only schemes a browser can safely open. Anything
 * fancier (bare `example.com`, `javascript:`) is left as ordinary text.
 */
const URL_RE = /\b(https?:\/\/|www\.)[^\s<>"']+/gi;

/** Sentence punctuation that follows a link far more often than it belongs. */
const TRAILING = /[.,;:!?]+$/;

const MAX_LABEL = 34;

export interface LinkMatch {
  /** Offsets into the string passed to `findLinks`. */
  from: number;
  to: number;
  /** What a click should open -- always absolute. */
  href: string;
  /** What to draw in its place. */
  label: string;
}

/**
 * A closing bracket ends the link unless the link opened it, so both
 * `(see https://example.com)` and a Wikipedia `..._(disambiguation)` work.
 */
function trimTrailing(raw: string): string {
  const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let text = raw.replace(TRAILING, "");
  while (text.length > 0) {
    const closer = text.slice(-1);
    const opener = PAIRS[closer];
    if (opener === undefined) break;
    const opens = text.split(opener).length - 1;
    const closes = text.split(closer).length - 1;
    if (opens >= closes) break;
    text = text.slice(0, -1).replace(TRAILING, "");
  }
  return text;
}

export function hrefFor(text: string): string {
  return /^www\./i.test(text) ? `https://${text}` : text;
}

/** `https://www.notion.so/a/very/long/page?x=1` -> `notion.so/a/very/long/pa…` */
export function shortenUrl(text: string): string {
  let url: URL;
  try {
    url = new URL(hrefFor(text));
  } catch {
    return text;
  }

  const host = url.host.replace(/^www\./i, "");
  const rest = `${url.pathname}${url.search}${url.hash}`.replace(/\/$/, "");
  if (rest === "") return host;

  const full = `${host}${rest}`;
  if (full.length <= MAX_LABEL) return full;
  // Never eat into the host: knowing where a link goes matters more than
  // knowing which page it lands on.
  return `${full.slice(0, Math.max(host.length, MAX_LABEL - 1))}…`;
}

export function findLinks(text: string): LinkMatch[] {
  const matches: LinkMatch[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const raw = trimTrailing(match[0]);
    // `www.` on its own is a word, not a link.
    if (raw.length === 0 || /^www\.?$/i.test(raw)) continue;
    const from = match.index ?? 0;
    matches.push({ from, to: from + raw.length, href: hrefFor(raw), label: shortenUrl(raw) });
  }
  return matches;
}
