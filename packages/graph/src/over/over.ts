/**
 * One module per event (#238): everything about an event in one object, and
 * a slice's fold, version table and undo table put together from a list of
 * them.
 *
 * Nothing here knows what an event means, or what any state holds. `over<S>()`
 * is made once per slice, for the state that slice folds, and hands back
 * `define` (one event) and `slice` (a list of them).
 *
 * An event's parts are written against its own payload type, so they are
 * checked against each other. `define` hands back the event with that type
 * hidden behind `unknown`, so a slice can hold events with different payloads
 * in one list.
 */
import type { Batched } from "../events/batch/batch.ts";
import { CANNOT } from "../undo/undo.ts";
import type { Check, Undo } from "../undo/undo.ts";

/** How to undo an event, written against its own payload. */
export type UndoOf<S, P> = {
  /** The events that undo it, from the state just before it: `[]` for none, `undefined` for cannot. */
  inverse(state: S, it: P): Batched[] | undefined;
  /** What a step must find as it left it, for it to be undone. */
  touched(state: S, it: P): Check<S>[];
};

/** Everything about one event, written against its own payload type `P`. */
export type Spec<S, P, T extends string> = {
  /** The event type, as it is written. */
  readonly type: T;
  /** The payload `v` this build reads and writes. */
  readonly v: number;
  /** The payload as this build reads it, or undefined when it is malformed. */
  parse(payload: unknown): P | undefined;
  /** The fold. Hands back `state` itself for a change that changes nothing. */
  apply<St extends S>(state: St, it: P): St;
  /**
   * Whether a prediction already shows it. Only for an event that is not safe
   * to fold twice; left off, a prediction always folds it.
   */
  landed?(state: S, it: P): boolean;
  /**
   * How to undo it, or `"cannot"` for an event no existing event can
   * reverse. Never left off: an event says it cannot be undone.
   */
  readonly undo: UndoOf<S, P> | "cannot";
};

/** An event as a slice holds it: its payload read from `unknown`. */
export type Event<S, T extends string = string> = {
  readonly type: T;
  readonly v: number;
  /** Whether `payload` is one this build reads. */
  reads(payload: unknown): boolean;
  /** The fold. `state` itself for a malformed payload. */
  reduce<St extends S>(state: St, payload: unknown): St;
  /** Whether a prediction already shows it. False for a malformed payload. */
  landed(state: S, payload: unknown): boolean;
  /** How to undo it, as the undo walk reads it. */
  readonly undo: Undo<S>;
};

/**
 * An event as it is written: its type, this build's `v`, and its payload.
 * A builder states it as its return type: events that undo each other call
 * each other's builders, and TypeScript cannot infer a type that depends on
 * itself.
 */
export type Written<T extends string, P> = { v: number; type: T; payload: P };

/** An event as its own module exports it: a slice's view of it, plus its payload type. */
export type Defined<S, P, T extends string> = Event<S, T> & {
  /** The payload as this build reads it, or undefined when it is malformed. */
  parse(payload: unknown): P | undefined;
  /** The event as it is written, with this build's `v`. */
  build(it: P): Written<T, P>;
};

/** The `{ type, payload }` an event module writes, for a slice's event union. */
export type EventOf<M> = M extends { type: infer T; build(it: infer P): unknown }
  ? { type: T; payload: P }
  : never;

/** An event as a fold is handed one: its `v` as well as its type and payload. */
export type Versioned = { type: string; v: number; payload: unknown };

/**
 * The gate in front of a fold: whether `handles` has `event`'s type, at a `v`
 * no higher than this build reads. An older build passes over what a newer
 * one wrote rather than fold it wrongly.
 */
export function admits(
  handles: Readonly<Record<string, number>>,
  event: { type: string; v: number },
): boolean {
  return Object.hasOwn(handles, event.type) && event.v <= handles[event.type];
}

/** A fold as a ledger runs one: where it starts, and one event at a time. */
export type Fold<S> = {
  readonly initial: S;
  reduce(state: S, event: Versioned): S;
};

/** A slice's fold, version table and undo table, put together from its events. */
export type Slice<S, T extends string> = {
  /** Event type → the payload `v` this build reads and writes. */
  readonly handles: Readonly<Record<T, number>>;
  /** Event type → how to undo it. */
  readonly undo: Readonly<Record<T, Undo<S>>>;
  /** Whether `event` is one of this slice's, well formed. */
  reads(event: { type: string; payload: unknown }): boolean;
  /** The fold: `state` itself for an event that is not one of this slice's, or is malformed. */
  reduce<St extends S>(state: St, event: { type: string; payload: unknown }): St;
  /** Whether a prediction already shows `event`. False for one not of this slice. */
  landed(state: S, event: { type: string; payload: unknown }): boolean;
  /**
   * The slice as a fold on its own, from `initial`, with the gate in front:
   * for a slice that is not behind another fold's gate, such as a plugin's.
   * The graph's slices are behind `graphFold`'s, and use `reduce`.
   */
  fold(initial: S): Fold<S>;
};

/** `spec` with its payload type hidden, and its builder. */
function define<S, P, const T extends string>(spec: Spec<S, P, T>): Defined<S, P, T> {
  const { type, v, parse, apply, landed, undo } = spec;
  return {
    type,
    v,
    parse,
    build: (it) => ({ v, type, payload: it }),
    reads: (payload) => parse(payload) !== undefined,
    reduce(state, payload) {
      const it = parse(payload);
      return it === undefined ? state : apply(state, it);
    },
    landed(state, payload) {
      const it = parse(payload);
      return it !== undefined && !!landed?.(state, it);
    },
    undo:
      undo === "cannot"
        ? CANNOT
        : {
            inverse(state, event) {
              const it = parse(event.payload);
              return it === undefined ? [] : undo.inverse(state, it);
            },
            touched(state, event) {
              const it = parse(event.payload);
              return it === undefined ? [] : undo.touched(state, it);
            },
          },
  };
}

/**
 * A slice put together from `events`. Two events with one type is a bug in
 * the slice, and throws when the module loads.
 */
function slice<S, const L extends readonly Event<S>[]>(events: L): Slice<S, L[number]["type"]> {
  type T = L[number]["type"];
  const by = new Map<string, Event<S>>();
  for (const event of events) {
    if (by.has(event.type)) throw new Error(`Two events are ${event.type}`);
    by.set(event.type, event);
  }
  const of = (type: string) => by.get(type);
  const handles = Object.fromEntries(events.map((it) => [it.type, it.v])) as Record<T, number>;
  const reduce = <St extends S>(state: St, event: { type: string; payload: unknown }): St =>
    of(event.type)?.reduce(state, event.payload) ?? state;
  return {
    handles,
    undo: Object.fromEntries(events.map((it) => [it.type, it.undo])) as Record<T, Undo<S>>,
    reads: (event) => of(event.type)?.reads(event.payload) ?? false,
    reduce,
    landed: (state, event) => of(event.type)?.landed(state, event.payload) ?? false,
    fold: (initial) => ({
      initial,
      reduce: (state, event) => (admits(handles, event) ? reduce(state, event) : state),
    }),
  };
}

/**
 * `define` and `slice` for events that fold `S`. Made once per slice, so
 * that `S` is said once and every event in it is checked against it.
 */
export function over<S>() {
  return {
    define: <P, const T extends string>(spec: Spec<S, P, T>) => define<S, P, T>(spec),
    slice: <const L extends readonly Event<S>[]>(events: L) => slice<S, L>(events),
  };
}
