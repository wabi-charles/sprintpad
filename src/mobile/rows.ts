import { parseLine, type LineKind } from "../doc/grammar";

/**
 * The document as a list of rows to draw.
 *
 * The phone does not render text the way the editor does -- it renders a list
 * -- but the text is still the model, so this is a projection of it and never
 * a copy. Every row carries the character offset of its line, which is the
 * coordinate everything else in the app already speaks: focus anchors, session
 * positions and every edit in `doc/edits.ts`.
 */

export interface Row {
  /** Zero-based line number. */
  index: number;
  /** Character offset of the start of the line. */
  from: number;
  /** Character offset of the end of the line, excluding the newline. */
  to: number;
  kind: LineKind;
  /** The line as written, markers and indent included. */
  raw: string;
  /** What to show: no indent, no marker. */
  text: string;
  done: boolean;
  /** Indent in levels. */
  depth: number;
}

export function rowsFor(doc: string): Row[] {
  const rows: Row[] = [];
  let from = 0;

  doc.split("\n").forEach((raw, index) => {
    const parsed = parseLine(raw);
    rows.push({
      index,
      from,
      to: from + raw.length,
      kind: parsed.kind,
      raw,
      text: parsed.text,
      done: parsed.completed,
      depth: parsed.indent,
    });
    from += raw.length + 1;
  });

  return rows;
}

/** The row containing a character offset, for following a focus anchor. */
export function rowAt(rows: readonly Row[], position: number): Row | null {
  return rows.find((row) => position >= row.from && position <= row.to) ?? null;
}

/**
 * Rows grouped under the header above them.
 *
 * A list without headers is one unnamed section rather than a special case,
 * so the renderer never has two shapes to handle.
 */
export interface Section {
  /** The header row, or null for tasks written before any header. */
  header: Row | null;
  rows: Row[];
}

/**
 * `keepBlank` is the offset of a blank line to show anyway.
 *
 * Blank lines are the spacing between groups and drawing them would leave gaps
 * down the list -- except for one: a task that has just been created is an
 * empty line until it is typed into, and hiding the row you are editing would
 * make the keyboard come up over nothing.
 */
export function sectionsFor(rows: readonly Row[], keepBlank?: number | null): Section[] {
  const sections: Section[] = [];
  let current: Section = { header: null, rows: [] };

  for (const row of rows) {
    if (row.kind === "header") {
      // An empty leading section is an artefact of starting before the first
      // header, not something to draw.
      if (current.header !== null || current.rows.length > 0) sections.push(current);
      current = { header: row, rows: [] };
      continue;
    }
    if (row.kind === "blank" && row.from !== keepBlank) continue;
    current.rows.push(row);
  }

  if (current.header !== null || current.rows.length > 0) sections.push(current);
  return sections;
}

/** How many tasks are left in a section, which is what a phone shows. */
export function openCount(section: Section): number {
  return section.rows.filter((row) => row.kind === "task" && !row.done).length;
}
