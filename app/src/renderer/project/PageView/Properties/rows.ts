/**
 * What editing a row of the properties table writes. Each function returns a
 * decision for the table to apply; none names a page, asks main for anything,
 * or touches React.
 *
 * Pure, over the rows as drawn (main's properties with this view's writes in
 * flight folded over them), so the rules run under `node --test`.
 */
import { canonicalize } from '@pbnotes/pages';
import type { Property } from '@pbnotes/pages';

/**
 * The one row open for editing: what its cells hold now, and `from`, the row
 * as it was drawn when it was opened. A draft, a row not written yet, has no
 * `from`.
 */
export type Open = { from?: Property; key: string; value: string };

/** One write a commit asks for. */
export type Write =
  /** `key` is now `value`. */
  | { kind: 'set'; key: string; value: string }
  /** `from` becomes `to`, keeping `value`, the value `from` is drawn with. */
  | { kind: 'rename'; from: string; to: string; value: string };

/**
 * What leaving a row does: the writes it makes, none at all included, or
 * `taken`, refused because the key is another row's.
 */
export type Commit = { kind: 'taken' } | { kind: 'writes'; writes: Write[] };

/** Two keys are one property when they are one page. */
const same = (a: string, b: string): boolean => canonicalize(a) === canonicalize(b);

/** The order `getProperties` lists them in, so a row drawn here sits where it will land. */
const byKey = (a: Property, b: Property): number => {
  const [x, y] = [canonicalize(a.key), canonicalize(b.key)];
  return x < y ? -1 : x > y ? 1 : 0;
};

/** A draft opened on nothing: what "+ Add property" and Enter open. */
export const draft = (): Open => ({ key: '', value: '' });

/**
 * A draft with no key yet. Enter in one has nothing to write and nowhere new
 * to go: the table points at the key instead of opening another.
 */
export const keyless = (open: Open): boolean => !open.from && open.key.trim() === '';

/**
 * What leaving `open` writes, over `rows` as drawn.
 *
 * - A blank key writes nothing. A draft is dropped; a written row goes back
 *   to what it was, value included, since clearing both cells reads as
 *   "never mind", not "set this to empty". Clearing never removes.
 * - A key that is another row's is `taken`, rather than overwriting it.
 * - A draft writes its key and value. So does a row another writer removed
 *   while it was open, if anything in it was changed: what was typed is not
 *   thrown away. Left as it was opened, it writes nothing.
 * - A row whose key is the same once canonicalized keeps its key: its
 *   spelling is the key page's, so retyping its case changes nothing. Its
 *   value is written if it was changed.
 * - Any other key is a rename, and then the value is written if it was
 *   changed, over the value the rename keeps.
 *
 * A value counts as changed against the row as it was opened, not as drawn
 * now, so a row whose value another writer changed while it was open does
 * not write the old value back over theirs.
 */
export function commit(rows: readonly Property[], open: Open): Commit {
  const key = open.key.trim();
  if (key === '') return { kind: 'writes', writes: [] };
  const { from } = open;
  const row = from && rows.find((it) => same(it.key, from.key));
  if (rows.some((it) => it !== row && same(it.key, key))) return { kind: 'taken' };

  const changed = from === undefined || open.value !== from.value;
  if (!row) {
    const edited = !from || changed || !same(from.key, key);
    return {
      kind: 'writes',
      writes: edited ? [{ kind: 'set', key, value: open.value }] : [],
    };
  }
  if (same(row.key, key)) {
    return {
      kind: 'writes',
      writes: changed ? [{ kind: 'set', key: row.key, value: open.value }] : [],
    };
  }
  const writes: Write[] = [{ kind: 'rename', from: row.key, to: key, value: row.value }];
  if (changed) writes.push({ kind: 'set', key, value: open.value });
  return { kind: 'writes', writes };
}

/**
 * The rows to draw, with `open` among them: a written row in its place, and
 * one another writer removed while it was open kept in the place it had, so
 * the cell being typed in does not move or remount. A draft is not here: it
 * goes after every row.
 */
export function shown(rows: readonly Property[], open: Open | null): Property[] {
  const from = open?.from;
  if (!from || rows.some((it) => same(it.key, from.key))) return [...rows];
  return [...rows, from].sort(byKey);
}

/** Whether `value` can be typed in a one-line cell. One with a newline is shown, not edited. */
export const editable = (value: string): boolean => !value.includes('\n');

/**
 * Which of the titles `found` to offer for the key being typed in `open`: not
 * what is typed already, and not a key another row has, which would only be
 * refused. The row's own key is offered, as the way back to it.
 */
export function suggested(
  found: readonly string[],
  rows: readonly Property[],
  open: Open,
): string[] {
  const own = open.from?.key;
  return found.filter(
    (title) =>
      !same(title, open.key.trim()) &&
      !rows.some((it) => same(it.key, title) && !(own !== undefined && same(it.key, own))),
  );
}
