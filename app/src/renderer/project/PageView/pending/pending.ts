/**
 * The writes a page has drawn ahead of main, and when each stops being drawn.
 *
 * Each is the event it will be recorded as, tagged once its write's reply is
 * back with the fold version that reply named. A view at that version or
 * later holds the event, so the event is drawn over any view older than that
 * and dropped by one that is not. Until the reply is back there is no tag,
 * and the event is drawn over everything. That makes arrival order not
 * matter: a view that lands before the reply, after it, or out of order with
 * another, all settle by comparing versions.
 *
 * Pure, so the rules run under `node --test`; `PageView` holds the list.
 */
import type { PageEvent, PropertyEvent } from '@pbnotes/pages';

/** Any event a page draws ahead of main: a block's, or a property's. */
type Drawn = PageEvent | PropertyEvent;

/** One write drawn ahead of main: its event, and the version its reply named. */
export type Pending = { event: Drawn; version?: number };

/** `events` are drawn now, ahead of their replies. */
export function drawn(all: Pending[], events: Drawn[]): Pending[] {
  return [...all, ...events.map((event) => ({ event }))];
}

/**
 * The reply for `event` is back. With a version it is tagged; without one —
 * nothing to compare a view against — it is dropped at once, and the page
 * goes back to what main last showed.
 */
export function recorded(
  all: Pending[],
  event: Drawn,
  version: unknown,
): Pending[] {
  return typeof version === 'number'
    ? all.map((it) => (it.event === event ? { ...it, version } : it))
    : all.filter((it) => it.event !== event);
}

/**
 * A write among `events` was refused, so the ones not yet recorded are
 * dropped at once: the refused one, and those after it that were never
 * sent. Those already recorded wait for a view like any other.
 */
export function refused(all: Pending[], events: Drawn[]): Pending[] {
  return all.filter(
    (it) => it.version !== undefined || !events.includes(it.event),
  );
}

/** What is still to draw over a view at `version`: what it does not hold. */
export function unseen(all: Pending[], version: number): Pending[] {
  return all.filter((it) => it.version === undefined || it.version > version);
}
