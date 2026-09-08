import { findLinks } from "../doc/links";

/**
 * Write a task's text into an element, drawing any URLs short and clickable.
 *
 * The timer names the thing you are working on, and a task that is mostly a
 * pasted address was showing the address instead of the work. This is the same
 * treatment the workpad gives a link -- host plus as much path as fits, the
 * full address on the hover -- so one reads the same wherever it appears.
 */

/** What each element was last given, so an unchanged panel is left alone. */
const painted = new WeakMap<HTMLElement, string>();

export function renderLinkedText(target: HTMLElement, text: string): void {
  // The panel repaints four times a second. Replacing an anchor under the
  // pointer would make it impossible to click.
  if (painted.get(target) === text) return;
  painted.set(target, text);

  const links = findLinks(text);
  if (links.length === 0) {
    target.textContent = text;
    return;
  }

  const parts: (string | HTMLAnchorElement)[] = [];
  let at = 0;

  for (const link of links) {
    if (link.from > at) parts.push(text.slice(at, link.from));

    const anchor = document.createElement("a");
    anchor.className = "sp-link";
    anchor.href = link.href;
    anchor.textContent = link.label;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.title = link.href;
    parts.push(anchor);

    at = link.to;
  }

  if (at < text.length) parts.push(text.slice(at));
  target.replaceChildren(...parts);
}
