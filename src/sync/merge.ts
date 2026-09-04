/**
 * A three-way merge over lines.
 *
 * Two devices editing one list disagree far more often than they truly
 * conflict: ticking a task on a phone while adding one at a desk touches
 * different lines, and there is exactly one sensible answer. The copy each
 * device last agreed with the server is the common ancestor, so that answer
 * can be worked out rather than asked for.
 *
 * Each side is reduced to a list of changes expressed in the ancestor's own
 * line numbers. Two changes collide only when they cover the same ancestor
 * lines -- deleting one task while the other device ticks the task above it
 * touches two different ranges, and merges without a word.
 */

export type MergeResult = { kind: "clean"; doc: string } | { kind: "conflict" };

/** A range of ancestor lines, and what one device put in their place. */
interface Change {
  /** Inclusive start in ancestor coordinates. */
  start: number;
  /** Exclusive end. Equal to `start` for a pure insertion. */
  end: number;
  replacement: string[];
}

function lines(doc: string): string[] {
  return doc.split("\n");
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

const isInsertion = (change: Change): boolean => change.start === change.end;

/**
 * Which ancestor lines survive into `side`, as a map of index to index. The
 * plain quadratic table is right here: a task list is hundreds of lines at the
 * very most, and this runs once per conflict rather than per keystroke.
 */
function survivors(base: readonly string[], side: readonly string[]): Map<number, number> {
  const width = side.length + 1;
  const table = new Int32Array((base.length + 1) * width);
  const at = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = base.length - 1; i >= 0; i--) {
    for (let j = side.length - 1; j >= 0; j--) {
      table[i * width + j] =
        base[i] === side[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const matched = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < base.length && j < side.length) {
    if (base[i] === side[j]) {
      matched.set(i, j);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) i++;
    else j++;
  }
  return matched;
}

/** What one device did to the ancestor, in the ancestor's line numbers. */
function changesFrom(base: readonly string[], side: readonly string[]): Change[] {
  const kept = survivors(base, side);
  const changes: Change[] = [];
  let si = 0;
  let bi = 0;

  while (bi < base.length) {
    const target = kept.get(bi);
    if (target !== undefined) {
      // Lines this device added ahead of an ancestor line it kept.
      if (target > si) changes.push({ start: bi, end: bi, replacement: side.slice(si, target) });
      si = target + 1;
      bi++;
      continue;
    }

    let end = bi;
    while (end < base.length && !kept.has(end)) end++;
    const sideEnd = end < base.length ? kept.get(end)! : side.length;
    changes.push({ start: bi, end, replacement: side.slice(si, sideEnd) });
    si = sideEnd;
    bi = end;
  }

  if (si < side.length) {
    changes.push({ start: base.length, end: base.length, replacement: side.slice(si) });
  }
  return changes;
}

export function mergeDocs(base: string, mine: string, theirs: string): MergeResult {
  const ancestor = lines(base);
  const ours = changesFrom(ancestor, lines(mine));
  const yours = changesFrom(ancestor, lines(theirs));

  const out: string[] = [];
  let bi = 0;
  let oi = 0;
  let yi = 0;

  while (bi < ancestor.length || oi < ours.length || yi < yours.length) {
    const ourChange: Change | undefined = ours[oi];
    const yourChange: Change | undefined = yours[yi];
    const next = Math.min(ourChange?.start ?? Infinity, yourChange?.start ?? Infinity);

    // Ancestor lines ahead of the next change: nobody touched them.
    if (bi < next && bi < ancestor.length) {
      out.push(ancestor[bi]!);
      bi++;
      continue;
    }
    if (next === Infinity) {
      while (bi < ancestor.length) out.push(ancestor[bi++]!);
      break;
    }

    const oursHere = ourChange?.start === next;
    const yoursHere = yourChange?.start === next;

    if (oursHere && yoursHere) {
      const a = ourChange!;
      const b = yourChange!;

      // An insertion sits before whatever the other device did to the line,
      // so the two do not compete for the same ground.
      if (isInsertion(a) && !isInsertion(b)) {
        out.push(...a.replacement);
        oi++;
        continue;
      }
      if (isInsertion(b) && !isInsertion(a)) {
        out.push(...b.replacement);
        yi++;
        continue;
      }
      // Both added something where there was nothing. Keeping both loses no
      // work, and two new tasks in one gap is not a disagreement worth asking
      // a person about.
      if (isInsertion(a) && isInsertion(b)) {
        out.push(...a.replacement, ...b.replacement);
        oi++;
        yi++;
        continue;
      }
      // Both rewrote the same ancestor lines. Identically is agreement;
      // otherwise there is no answer that is not somebody's guess.
      if (a.end === b.end && same(a.replacement, b.replacement)) {
        out.push(...a.replacement);
        bi = a.end;
        oi++;
        yi++;
        continue;
      }
      return { kind: "conflict" };
    }

    const mineTurn = oursHere ? ourChange! : yourChange!;
    const other = oursHere ? yourChange : ourChange;
    if (other && other.start < mineTurn.end) return { kind: "conflict" };

    out.push(...mineTurn.replacement);
    bi = Math.max(bi, mineTurn.end);
    if (oursHere) oi++;
    else yi++;
  }

  return { kind: "clean", doc: out.join("\n") };
}
