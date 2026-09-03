/**
 * The document is plain text. This module is the only place that knows how a
 * line of that text maps to a task, a header, or nothing at all.
 */

export const INDENT_UNIT = "  ";
const SPACES_PER_LEVEL = 2;

/** `[]`, `[ ]`, `[x]` or `[X]` at the start of a line, after optional indent. */
const TASK_RE = /^([ \t]*)\[([ xX]?)\][ \t]?(.*)$/;

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
  /** Offset of `[` within the line, or -1 when there is no marker. */
  markerFrom: number;
  /** Offset just past `]` within the line, or -1 when there is no marker. */
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
    if (ch === "\t") {
      level += 1;
    } else {
      spaces += 1;
    }
  }
  return level + Math.floor(spaces / SPACES_PER_LEVEL);
}

export function parseLine(line: string): ParsedLine {
  const task = TASK_RE.exec(line);
  if (task) {
    const [, indentText = "", mark = "", text = ""] = task;
    return {
      kind: "task",
      indent: indentLevel(indentText),
      indentText,
      completed: mark.toLowerCase() === "x",
      text,
      markerFrom: indentText.length,
      markerTo: indentText.length + mark.length + 2,
    };
  }

  if (line.trim() === "") {
    return {
      kind: "blank",
      indent: 0,
      indentText: line,
      completed: false,
      text: "",
      markerFrom: -1,
      markerTo: -1,
    };
  }

  const indentText = /^[ \t]*/.exec(line)?.[0] ?? "";
  return {
    kind: "header",
    indent: indentLevel(indentText),
    indentText,
    completed: false,
    text: line.slice(indentText.length),
    markerFrom: -1,
    markerTo: -1,
  };
}

export function isTaskLine(line: string): boolean {
  return TASK_RE.test(line);
}

export function serializeTask(indent: number, completed: boolean, text: string): string {
  return `${INDENT_UNIT.repeat(Math.max(0, indent))}[${completed ? "x" : ""}] ${text}`;
}

/** The marker text for a state, written into just the marker span. */
export function markerFor(completed: boolean): string {
  return completed ? "[x]" : "[]";
}

export function indentTextFor(level: number): string {
  return INDENT_UNIT.repeat(Math.max(0, level));
}

/**
 * Widens what we accept on import and paste: markdown checklists and the
 * unicode boxes we render become the plain `[]` form the document uses.
 */
export function normalizeImportedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^([ \t]*)[-*+][ \t]+\[([ xX]?)\][ \t]?/, (_m, indent: string, mark: string) =>
          `${indent}[${mark.toLowerCase() === "x" ? "x" : ""}] `)
        .replace(/^([ \t]*)([☐☑☒])[ \t]?/, (_m, indent: string, box: string) =>
          `${indent}[${box === "☐" ? "" : "x"}] `),
    )
    .join("\n");
}
