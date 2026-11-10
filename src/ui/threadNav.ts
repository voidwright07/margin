/**
 * Thread navigation on a flat, depth-ordered comment list, the way HN stores it. It works on the full comment
 * array and on the visible rows alike, because collapsing hides only descendants: a visible row's parent, root
 * and neighbouring top-level comments are always visible too.
 */

export type ThreadMove = 'parent' | 'root' | 'nextTop' | 'prevTop';

type Depths = ReadonlyArray<{ depth: number }>;

/** Nearest earlier row at `depth`. Passing a shallower row first means the ancestor is not on this page. */
const findBack = (rows: Depths, from: number, depth: number): number | null => {
  for (let i = from; i >= 0; i--) {
    if (rows[i]!.depth === depth) return i;
    if (rows[i]!.depth < depth) return null;
  }
  return null;
};

/** Index of the row a move from `at` lands on, or null when there is none. */
export const navTarget = (rows: Depths, at: number, move: ThreadMove): number | null => {
  const here = rows[at];
  if (!here) return null;
  switch (move) {
    case 'parent':
      return here.depth === 0 ? null : findBack(rows, at - 1, here.depth - 1);
    case 'root':
      return here.depth === 0 ? null : findBack(rows, at - 1, 0);
    case 'prevTop':
      return findBack(rows, at - 1, 0);
    case 'nextTop':
      for (let i = at + 1; i < rows.length; i++) if (rows[i]!.depth === 0) return i;
      return null;
  }
};
