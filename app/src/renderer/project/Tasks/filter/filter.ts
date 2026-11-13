/**
 * Steps on a filter (#387), the first sketch of block filters: what a pick
 * in the `+ Filter` menu does, what a chip's × does, and the chips a filter
 * shows as. Pure, so it runs under `node --test`; the filter itself is the
 * tab's (`TabState.filter`), and main reads it (`requireFilter`).
 *
 * A condition holds at least one value: the last one taken off a condition
 * takes the condition with it, which leaves that kind unfiltered.
 */
import type { Marker } from '@pbnotes/graph';
import type { Condition, Filter, FilterPick } from '../../../../shared/graph.ts';

/** One value of one condition, as a chip shows it and its × takes it off. */
export type Chip = { kind: 'marker'; marker: Marker };

/** Every value in `filter`, a chip each, in the order they are held. */
export function chips(filter: Filter): Chip[] {
  return filter.flatMap((it) => it.markers.map((marker) => ({ kind: it.kind, marker })));
}

/**
 * `filter` with `pick` turned on, or off when it is on already. The same
 * filter, as it was, for a step that changes nothing.
 */
export function picked(filter: Filter, pick: FilterPick): Filter {
  const at = filter.find((it) => it.kind === pick.kind);
  if (!at) return [...filter, { kind: pick.kind, markers: [pick.marker] }];
  const markers = at.markers.includes(pick.marker)
    ? at.markers.filter((it) => it !== pick.marker)
    : [...at.markers, pick.marker];
  return withCondition(filter, at, markers);
}

/** `filter` with `chip` taken off: what its × does. */
export function unchipped(filter: Filter, chip: Chip): Filter {
  const at = filter.find((it) => it.kind === chip.kind);
  if (!at || !at.markers.includes(chip.marker)) return filter;
  return withCondition(filter, at, at.markers.filter((it) => it !== chip.marker));
}

/** `filter` with `at` holding `markers` instead, or gone when that is none. */
function withCondition(filter: Filter, at: Condition, markers: Marker[]): Filter {
  return markers.length === 0
    ? filter.filter((it) => it !== at)
    : filter.map((it) => (it === at ? { ...it, markers } : it));
}
