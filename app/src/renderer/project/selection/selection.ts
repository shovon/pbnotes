/**
 * A selection of things that show in a line, one after another (#253). Pure,
 * and generic: it knows keys and the order they show in, and nothing of
 * blocks, pages or the DOM. `Tab` reads the order off the screen and
 * hands it in each time; each function gives back a new selection, with what
 * it selects worked out against that order.
 *
 * A selection is what was picked one at a time (`base`, from Cmd/Ctrl+click)
 * plus, once Shift+Up or Shift+Down has been pressed, the run from the anchor
 * to the head. Picking one key on its own makes that key the anchor, and a
 * run grown after a Cmd/Ctrl+click adds to what was picked, as Finder does.
 */

export type Selection = {
  /** Picked one at a time, kept whatever the run does. */
  readonly base: readonly string[];
  /** Where the run starts: the key last picked. */
  readonly anchor: string;
  /** Where the run ends, and what Up and Down move from. */
  readonly head: string;
  /** Whether there is a run, from `anchor` to `head`. */
  readonly run: boolean;
  /** Everything selected, in the order it shows. Never empty. */
  readonly keys: readonly string[];
};

/** `key` alone. */
export function pick(key: string): Selection {
  return { base: [], anchor: key, head: key, run: true, keys: [key] };
}

/**
 * Cmd/Ctrl+click: `key` added to the selection, or taken out of it. Either
 * way it is the new anchor. Null when that leaves nothing selected.
 */
export function toggle(
  selection: Selection | null,
  key: string,
  order: readonly string[],
): Selection | null {
  if (!selection) return pick(key);
  const had = selection.keys.includes(key);
  const base = had
    ? selection.keys.filter((it) => it !== key)
    : [...selection.keys, key];
  return settle({ base, anchor: key, head: key, run: false }, order);
}

/**
 * Shift+Up (`by: -1`) or Shift+Down (`by: 1`): the head moves one along, and
 * the run goes from the anchor to it. Stays put at either end.
 *
 * `steps` is what the head may stop on, when not all of `order`: a caller
 * leaves out what already shows selected, so no press goes by with nothing
 * to see. The run still goes over everything between, in `order`.
 */
export function extend(
  selection: Selection,
  order: readonly string[],
  by: 1 | -1,
  steps: readonly string[] = order,
): Selection {
  const head = beside(steps, selection.head, by);
  if (head === undefined) return selection;
  return settle({ ...selection, head, run: true }, order) ?? selection;
}

/**
 * A drag (#262): what was there to keep, `base`, plus the run from `anchor`
 * to `head`. A plain drag keeps nothing; Cmd/Ctrl+drag keeps what was
 * selected, as Finder does. Null when that selects nothing.
 */
export function span(
  base: readonly string[],
  anchor: string,
  head: string,
  order: readonly string[],
): Selection | null {
  return settle({ base, anchor, head, run: true }, order);
}

/** Up or Down: the key beside the head, alone. Stays put at either end. */
export function move(
  selection: Selection,
  order: readonly string[],
  by: 1 | -1,
): Selection {
  const next = beside(order, selection.head, by);
  return next === undefined ? selection : pick(next);
}

/** Every one of `keys`, as picked one at a time. Null for none. */
export function every(keys: readonly string[]): Selection | null {
  if (keys.length === 0) return null;
  return {
    base: keys,
    anchor: keys[0],
    head: keys[keys.length - 1],
    run: false,
    keys,
  };
}

/**
 * The selection over a new order, once what shows has changed: what is gone
 * drops out. Null when the anchor went, or nothing selected is left.
 */
export function follow(
  selection: Selection,
  order: readonly string[],
): Selection | null {
  if (!order.includes(selection.anchor)) return null;
  if (order.includes(selection.head)) return settle(selection, order);
  // The head went: what is left of the run stays, picked as it is, and the
  // next Shift+Up or Shift+Down starts again from the anchor.
  const { anchor, keys } = selection;
  return settle({ base: keys, anchor, head: anchor, run: false }, order);
}

/** The key `by` along from `key`, or undefined past either end or when it is not shown. */
function beside(order: readonly string[], key: string, by: 1 | -1): string | undefined {
  const at = order.indexOf(key);
  return at === -1 ? undefined : order[at + by];
}

/** `keys` worked out against `order`. Null when nothing is selected. */
function settle(
  { base, anchor, head, run }: Omit<Selection, "keys">,
  order: readonly string[],
): Selection | null {
  const picked = new Set(base);
  const from = order.indexOf(anchor);
  const to = order.indexOf(head);
  const [low, high] = from < to ? [from, to] : [to, from];
  const inRun = (at: number) => run && low !== -1 && at >= low && at <= high;
  const keys = order.filter((key, at) => picked.has(key) || inRun(at));
  return keys.length === 0 ? null : { base, anchor, head, run, keys };
}
