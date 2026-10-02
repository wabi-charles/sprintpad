/**
 * Following lines from one version of a document into the next.
 *
 * Two things need this. The three-way merge has to know which lines each
 * device kept, and the phone has to know where a task went after an edit --
 * the editor gets that for free from CodeMirror, which maps positions through
 * every change, but the phone replaces the document as a string and gets
 * nothing. Without it, adding a task above the one being focused on left the
 * session pointing at whatever slid into its place, and Done ticked that.
 */

/**
 * Which lines of `a` survive into `b`, as a map of index to index.
 *
 * The common head and tail are matched first and only the middle goes through
 * the quadratic table. That is what every practical diff does, and it is what
 * makes this cheap enough to run on every keystroke: typing changes one line,
 * so the middle is one line long.
 */
export function survivingLines(a: readonly string[], b: readonly string[]): Map<number, number> {
  const matched = new Map<number, number>();

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    matched.set(head, head);
    head++;
  }

  let tailA = a.length;
  let tailB = b.length;
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) {
    tailA--;
    tailB--;
  }

  const rows = tailA - head;
  const cols = tailB - head;
  if (rows > 0 && cols > 0) {
    const width = cols + 1;
    const table = new Int32Array((rows + 1) * width);
    const at = (i: number, j: number): number => table[i * width + j] ?? 0;
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        table[i * width + j] =
          a[head + i] === b[head + j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
      }
    }

    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (a[head + i] === b[head + j]) {
        matched.set(head + i, head + j);
        i++;
        j++;
      } else if (at(i + 1, j) >= at(i, j + 1)) i++;
      else j++;
    }
  }

  for (let k = 0; tailA + k < a.length; k++) matched.set(tailA + k, tailB + k);
  return matched;
}

function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
}

/** The line holding a character offset, and how far into it the offset is. */
function locate(starts: readonly number[], lines: readonly string[], position: number) {
  let index = 0;
  while (index + 1 < starts.length && starts[index + 1]! <= position) index++;
  return { index, column: Math.min(position - starts[index]!, lines[index]!.length) };
}

/**
 * Where each position in `before` lands in `after`, or null where its line is
 * gone.
 *
 * In order of how sure the answer is:
 *
 * - A line the diff kept is followed wherever it went.
 * - A line the diff did not keep may simply have been dragged: a move is a
 *   delete and an insert as far as a diff can tell. If exactly one line that
 *   appeared in `after` has exactly its text, that is where it went.
 * - A line edited in place -- renamed, ticked, indented -- has no exact match
 *   anywhere, so it is placed by its neighbours: if the stretch between the
 *   surviving lines either side is as long before as after, the edit replaced
 *   like with like and the position keeps its place in it.
 *
 * Anything else is null. Lines were added or removed around it and there is no
 * honest answer, so the caller falls back to finding the task by name.
 */
export function mapPositions(
  before: string,
  after: string,
  positions: readonly number[],
): (number | null)[] {
  if (before === after) return [...positions];

  const a = before.split("\n");
  const b = after.split("\n");
  const kept = survivingLines(a, b);
  const startsA = lineStarts(a);
  const startsB = lineStarts(b);

  const place = (index: number, column: number): number =>
    startsB[index]! + Math.min(column, b[index]!.length);

  const keptInB = new Set(kept.values());
  const appeared = b.map((_, j) => j).filter((j) => !keptInB.has(j));

  return positions.map((position) => {
    const { index, column } = locate(startsA, a, position);

    const direct = kept.get(index);
    if (direct !== undefined) return place(direct, column);

    const moved = appeared.filter((j) => b[j] === a[index]);
    if (moved.length === 1) return place(moved[0]!, column);

    // The surviving neighbours either side bound the stretch that changed.
    let above = index - 1;
    while (above >= 0 && !kept.has(above)) above--;
    let below = index + 1;
    while (below < a.length && !kept.has(below)) below++;

    const fromB = above >= 0 ? kept.get(above)! + 1 : 0;
    const toB = below < a.length ? kept.get(below)! : b.length;
    const fromA = above + 1;

    if (below - fromA !== toB - fromB) return null;
    return place(fromB + (index - fromA), column);
  });
}
