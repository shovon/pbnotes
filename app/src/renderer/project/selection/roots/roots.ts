/**
 * What a selection hands to whatever acts on it (#253): the top-most selected
 * things, in the order they show, each standing for its whole subtree. Pure,
 * and generic over a forest: a thing is a key, the key of what it shows
 * under (if that shows), and the id of what it stands for.
 *
 * A thing can show more than once (a block on its day and under a page it
 * links to), each time under its own key. It is handed on once, where it
 * first shows, and not at all when it shows anywhere under a selected thing.
 *
 * Only what shows is known here. A linked reference shows a block without
 * what it hangs under, so a block selected there and its parent selected on
 * its own page are both handed on. Whatever acts on them checks against the
 * graph, which knows.
 */

export type Shown = {
  /** This place it shows. */
  key: string;
  /** The key it shows under, when it shows under something. */
  parent?: string;
  /** What it is, the same wherever it shows. */
  id: string;
};

/**
 * The keys in `order` that show under something selected, which a selected
 * thing brings with it. Selecting a thing anywhere selects all of it, so
 * what shows under another place the same thing shows counts too.
 */
export function covered<T extends Shown>(
  order: readonly T[],
  selected: Iterable<string>,
): Set<string> {
  const chosen = new Set(selected);
  const byKey = new Map(order.map((it) => [it.key, it]));
  const chosenIds = new Set(order.filter((it) => chosen.has(it.key)).map((it) => it.id));
  const under = (it: T): boolean => {
    const seen = new Set<string>([it.key]);
    for (let up = it.parent; up !== undefined && !seen.has(up); up = byKey.get(up)?.parent) {
      const above = byKey.get(up);
      if (chosen.has(up) || (above && chosenIds.has(above.id))) return true;
      seen.add(up);
    }
    return false;
  };
  return new Set(order.filter(under).map((it) => it.key));
}

/**
 * The entries of `selected` that nothing else in `selected` shows above, in
 * `order`'s order, once per id. `order` is everything that shows, so a parent
 * that is not selected still leads up to one that is.
 */
export function roots<T extends Shown>(
  order: readonly T[],
  selected: Iterable<string>,
): T[] {
  const chosen = new Set(selected);
  const below = covered(order, chosen);
  const ids = new Set<string>();
  return order.filter((it) => {
    if (!chosen.has(it.key) || ids.has(it.id) || below.has(it.key)) return false;
    ids.add(it.id);
    return true;
  });
}
