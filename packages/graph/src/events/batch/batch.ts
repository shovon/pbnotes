/**
 * A batch (#225): several events written as one record, folded all together
 * or not at all. A crash or a sync that stops between two records can leave
 * the folder halfway through something the user did; one record cannot be
 * half there.
 *
 * Nothing here knows what the events inside mean. The fold that does decides
 * which it reads, and `all` folds them only if it reads every one.
 */
import { field, NAMESPACE } from "../events.ts";
import type { Named } from "../events.ts";

/** An event as a batch holds it, and as a builder returns one. */
export type Batched = { type: string; v: number; payload: unknown };

/** These events, in this order, as one. */
export type BatchEvent = { type: Named<"batch">; payload: { events: Batched[] } };

const BATCH: BatchEvent["type"] = `${NAMESPACE}batch`;

/** The batch's half of `HANDLES`. */
export const BATCH_HANDLES: Record<BatchEvent["type"], number> = { [BATCH]: 1 };

/**
 * The `batch` event holding `events`, in order. Throws for none, or for a
 * batch among them: either is a bug in the caller, never something read from
 * a log.
 */
export function batch(events: readonly Batched[]): BatchEvent & { v: number } {
  if (events.length === 0) throw new Error("A batch needs at least one event");
  if (events.some((event) => event.type === BATCH)) {
    throw new Error("A batch cannot hold a batch");
  }
  return {
    v: BATCH_HANDLES[BATCH],
    type: BATCH,
    payload: { events: events.map(({ type, v, payload }) => ({ type, v, payload })) },
  };
}

/** One entry of `events` as written: an object with a string type, a number `v` and a payload. */
function entry(raw: unknown): Batched | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const type = field(raw, "type");
  const v = field(raw, "v");
  if (typeof type !== "string" || typeof v !== "number" || !Object.hasOwn(raw, "payload")) {
    return undefined;
  }
  return { type, v, payload: field(raw, "payload") };
}

/**
 * The events a batch holds, in order, or undefined for an event that is not a
 * well-formed batch: not a batch, a payload that is not an object, `events`
 * that is not a list or is empty, an entry that is not `{ type, v, payload }`,
 * or a batch inside it. Malformed anywhere is malformed whole.
 */
export function unbatch(event: { type: string; payload: unknown }): Batched[] | undefined {
  const { type, payload } = event;
  if (type !== BATCH || typeof payload !== "object" || payload === null) return undefined;
  const raw = field(payload, "events");
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const events = raw.map(entry);
  return events.every((it): it is Batched => it !== undefined && it.type !== BATCH)
    ? events
    : undefined;
}

/**
 * Every event in `events`, with each well-formed batch in place of the events
 * it holds. For a view that draws its own writes ahead of the fold: whether
 * each one is read is still the fold's to say.
 */
export function* each<E extends { type: string; payload: unknown }>(
  events: Iterable<E>,
): Generator<E | Batched> {
  for (const event of events) yield* unbatch(event) ?? [event];
}

/**
 * `events` folded into `state` one after another, if `reads` is true of
 * every one; otherwise `state` itself, folding none of them.
 */
export function all<S, E>(
  state: S,
  events: readonly E[],
  reads: (event: E) => boolean,
  reduce: (state: S, event: E) => S,
): S {
  return events.every(reads) ? events.reduce(reduce, state) : state;
}
