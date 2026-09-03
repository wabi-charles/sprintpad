import type { ThemePreference } from "../data/storage";

/**
 * Light and dark are CSS variables; this only decides which set is active and
 * tells CodeMirror, which needs to know for its own internals.
 */
export function createTheme(initial: ThemePreference, onChange: (dark: boolean) => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let preference: ThemePreference = initial;

  const isDark = () => (preference === "system" ? media.matches : preference === "dark");

  function apply(): void {
    const root = document.documentElement;
    if (preference === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", preference);
    onChange(isDark());
  }

  media.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  apply();

  return {
    get preference(): ThemePreference {
      return preference;
    },
    get dark(): boolean {
      return isDark();
    },
    set(next: ThemePreference): void {
      preference = next;
      apply();
    },
    /** Flips to the opposite of what is on screen right now. */
    toggle(): ThemePreference {
      preference = isDark() ? "light" : "dark";
      apply();
      return preference;
    },
  };
}

export type Theme = ReturnType<typeof createTheme>;
