/**
 * Keeps Tab inside an open dialog.
 *
 * Without it the focus ring wanders out into the document behind, which for a
 * keyboard-first app is worse than the usual: the thing behind is a text
 * editor, so tabbing out means typing into a list you cannot see.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function trapFocus(container: HTMLElement): () => void {
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;

    const targets = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null,
    );
    if (targets.length === 0) return;

    const first = targets[0]!;
    const last = targets[targets.length - 1]!;
    const active = document.activeElement;

    // Wrap at both ends, and catch focus that has already escaped.
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  container.ownerDocument.addEventListener("keydown", onKeydown, true);
  return () => container.ownerDocument.removeEventListener("keydown", onKeydown, true);
}
