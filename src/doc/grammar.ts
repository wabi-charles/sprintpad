/**
 * The document is plain text. This module is the only place that knows how a
 * line of that text maps to a task, a header, or nothing at all.
 *
 * A bare line is a task: capture should cost nothing but the words. Only the
 * two things you never type by hand carry a marker -- `[x] ` for done (set by
 * ⌘D or the checkbox) and `# ` for a header.
 */

export const INDENT_UNIT = "  ";
const SPACES_PER_LEVEL = 2;

const INDENT_RE = /^[ \t]*/;
const HEADER_RE = /^([ \t]*)(#+[ \t]?)(.*)$/;
const DONE_RE = /^([ \t]*)(\[[xX]\][ \t]?)(.*)$/;
const OPEN_RE = /^([ \t]*)(\[ ?\][ \t]?)(.*)$/;

export type LineKind = "task" | "header" | "blank";

export interface ParsedLine {
  kind: LineKind;
  /** Indent depth in levels, not characters. */
  indent: number;
  /** The raw leading whitespace, as written. */
  indentText: string;
  /** Meaningful only for tasks. */
  completed: boolean;
  /** Line content with indent and any marker stripped. */
  text: string;
  /** Start of the marker span. Empty span (from === to) for a bare task. */
  markerFrom: number;
  /** End of the marker span, including its trailing space. */
  markerTo: number;
}

/**
 * A tab counts as one full level; spaces divide down, so a hand-typed extra
 * space reads as the level it is closest to rather than inventing a new one.
 */
function indentLevel(indentText: string): number {
  let level = 0;
  let spaces = 0;
  for (const ch of indentText) {
    if (ch === "\t") level += 1;
    else spaces += 1;
  }
  return level + Math.floor(spaces / SPACES_PER_LEVEL);
}

function marked(
  kind: LineKind,
  completed: boolean,
  indentText: string,
  marker: string,
  text: string,
): ParsedLine {
  return {
    kind,
    indent: indentLevel(indentText),
    indentText,
    completed,
    text,
    markerFrom: indentText.length,
    markerTo: indentText.length + marker.length,
  };
}

export function parseLine(line: string): ParsedLine {
  if (line.trim() === "") {
    return {
      kind: "blank",
      // Blank lines carry a level too: Enter steps out of a nested group one
      // level at a time, so it has to know how deep the empty line sits.
      indent: indentLevel(line),
      indentText: line,
      completed: false,
      text: "",
      markerFrom: -1,
      markerTo: -1,
    };
  }

  const header = HEADER_RE.exec(line);
  if (header) {
    const [, indent = "", marker = "", text = ""] = header;
    return marked("header", false, indent, marker, text);
  }

  const done = DONE_RE.exec(line);
  if (done) {
    const [, indent = "", marker = "", text = ""] = done;
    return marked("task", true, indent, marker, text);
  }

  const open = OPEN_RE.exec(line);
  if (open) {
    const [, indent = "", marker = "", text = ""] = open;
    return marked("task", false, indent, marker, text);
  }

  const indentText = INDENT_RE.exec(line)?.[0] ?? "";
  return marked("task", false, indentText, "", line.slice(indentText.length));
}

/** The marker text for a task state, written into just the marker span. */
export function markerFor(completed: boolean): string {
  return completed ? "[x] " : "";
}

export const HEADER_MARKER = "# ";

export function indentTextFor(level: number): string {
  return INDENT_UNIT.repeat(Math.max(0, level));
}

/**
 * Widens what we accept on import and paste: markdown checklists, plain
 * bullets and the unicode boxes we render all become canonical lines.
 */
export function normalizeImportedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(
          /^([ \t]*)[-*+][ \t]+\[([ xX]?)\][ \t]?/,
          (_m, indent: string, mark: string) => indent + markerFor(mark.toLowerCase() === "x"),
        )
        .replace(
          /^([ \t]*)([☐☑☒])[ \t]?/,
          (_m, indent: string, box: string) => indent + markerFor(box !== "☐"),
        )
        .replace(/^([ \t]*)[-*+][ \t]+/, "$1"),
    )
    .join("\n");
}

/**
 * Version 1 documents used the opposite rule: `[]` made a task and a bare line
 * was a header. Bare lines therefore have to become explicit headers, or a
 * stored document would silently reinterpret every heading as a task.
 */
export function migrateLegacyDoc(doc: string): string {
  return doc
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return line;
      if (HEADER_RE.test(line)) return line;
      const open = OPEN_RE.exec(line);
      if (open) {
        const [, indent = "", , text = ""] = open;
        return indent + text;
      }
      if (DONE_RE.test(line)) return line;
      const indentText = INDENT_RE.exec(line)?.[0] ?? "";
      return indentText + HEADER_MARKER + line.slice(indentText.length);
    })
    .join("\n");
}
