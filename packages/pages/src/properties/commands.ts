/**
 * Writing properties: a pure builder per event, and a command per change that
 * checks the state before it builds and dispatches (#133). One set for every
 * target kind.
 *
 * The commands refuse what the gate would skip, by running each event they
 * build through `parseProperty`, so the rule lives in one place. They do not
 * trim or normalize anything themselves: the fold does that on every read.
 *
 * Whether a target exists is not this slice's call, so the view brings
 * `exists`. `pages.ts` wires it from the block fold.
 */
import { NAMESPACE } from "../events/events.ts";
import type { Named } from "../events/events.ts";
import { changes, list, parseProperty, PROPERTY_HANDLES } from "./properties.ts";
import type { Parsed, Properties, PropertyEvent, Scalar, Seen, Target } from "./properties.ts";

/**
 * What the commands need: the properties as they stand, whether a target is
 * there to hang them on, and a way to append one of this fold's events.
 */
export type PropertiesView = {
  readonly state: { readonly properties: Properties };
  exists(of: Target): boolean;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: PropertyEvent["type"], payload: unknown): Promise<unknown>;
};

/** A property event without its namespace: what `build` is handed. */
type Bare<E = PropertyEvent> = E extends {
  type: `${typeof NAMESPACE}${infer T}`;
  payload: infer P;
}
  ? { type: T; payload: P }
  : never;

/** One event as it is written: schema type and payload, plus the `v` the gate reads. */
type Built<T extends string> = Extract<PropertyEvent, { type: Named<T> }> & { v: number };

/**
 * The one place a property event is put together. The payload is typed
 * against the schema and `v` comes from `PROPERTY_HANDLES`. Reads no clock
 * and checks nothing against the state.
 */
function build<T extends Bare["type"]>(
  name: T,
  payload: Extract<Bare, { type: T }>["payload"],
): Built<T> {
  const type = `${NAMESPACE}${name}` as Named<T>;
  return { v: PROPERTY_HANDLES[type], type, payload } as Built<T>;
}

/** The `property.set` event: the value at `path` on `of` is now `value`. */
export function propertySet(of: Target, path: string[], value: Scalar): Built<"property.set"> {
  return build("property.set", { of, path, value });
}

/** The `property.unset` event: `path` on `of` has no value. */
export function propertyUnset(of: Target, path: string[]): Built<"property.unset"> {
  return build("property.unset", { of, path });
}

/** The `property.item.added` event: `item` is among the items at `path` on `of`. */
export function propertyItemAdded(
  of: Target,
  path: string[],
  item: Scalar,
): Built<"property.item.added"> {
  return build("property.item.added", { of, path, item });
}

/** The `property.item.removed` event: `item` is no longer among them. */
export function propertyItemRemoved(
  of: Target,
  path: string[],
  item: Scalar,
): Built<"property.item.removed"> {
  return build("property.item.removed", { of, path, item });
}

/** The `property.removed` event: what the writer saw at each path, gone. */
export function propertyRemoved(of: Target, seen: Seen[]): Built<"property.removed"> {
  return build("property.removed", { of, seen });
}

type AnyBuilt = Built<Bare["type"]>;

/** `event` as the gate reads it, or a refusal: the fold would skip it. */
function parsed(event: AnyBuilt): Parsed {
  const out = parseProperty(event);
  if (!out) throw new Error("Not a valid property");
  return out;
}

/**
 * Refuses a target or path the gate would skip, and a target the fold
 * doesn't have, before anything is built from the state. The path is
 * checked the gate's own way, through the `unset` it would make.
 */
function check(view: PropertiesView, of: Target, path: string[]): void {
  parsed(propertyUnset(of, path));
  if (!view.exists(of)) throw new Error("No such block");
}

function append(view: PropertiesView, event: AnyBuilt): Promise<unknown> {
  return view.dispatch(event.v, event.type, event.payload);
}

/**
 * The shape of the four single-path commands: refuse what the fold would
 * skip, and write `event` only when it would change something, so the log
 * does not collect events that mean nothing.
 */
async function write(view: PropertiesView, event: AnyBuilt): Promise<void> {
  const edits = parsed(event);
  if (!view.exists(edits.of)) throw new Error("No such block");
  if (changes(view.state.properties, edits)) await append(view, event);
}

/** Sets the value at `path`. Its items are untouched. */
export function setProperty(
  view: PropertiesView,
  of: Target,
  path: string[],
  value: Scalar,
): Promise<void> {
  return write(view, propertySet(of, path, value));
}

/** Takes away the value at `path`. Its items are untouched. */
export function unsetProperty(view: PropertiesView, of: Target, path: string[]): Promise<void> {
  return write(view, propertyUnset(of, path));
}

/**
 * Adds `item` at `path`. One already there writes nothing: the fold would
 * move it to the end, but the user added nothing. Whether it is there is
 * asked the fold's way, by whether removing it would change anything.
 */
export async function addPropertyItem(
  view: PropertiesView,
  of: Target,
  path: string[],
  item: Scalar,
): Promise<void> {
  const event = propertyItemAdded(of, path, item);
  const edits = parsed(event);
  if (!view.exists(edits.of)) throw new Error("No such block");
  const present = changes(view.state.properties, parsed(propertyItemRemoved(of, path, item)));
  if (!present) await append(view, event);
}

/** Removes `item` from `path`. The value is untouched. */
export function removePropertyItem(
  view: PropertiesView,
  of: Target,
  path: string[],
  item: Scalar,
): Promise<void> {
  return write(view, propertyItemRemoved(of, path, item));
}

/** What the state holds at and under `path`, as a `removed` would list it. */
function seenAt(view: PropertiesView, of: Target, path: string[]): Seen[] {
  return list(view.state, of, path).map(({ path, value, items }) => ({
    path,
    ...(value === undefined ? {} : { value }),
    items: [...items],
  }));
}

/**
 * Removes what `view.state` holds at `path` and under it, as one event. What
 * another device wrote that this state hasn't seen survives, by design.
 * Nothing there writes nothing.
 */
export async function removeProperty(
  view: PropertiesView,
  of: Target,
  path: string[],
): Promise<void> {
  check(view, of, path);
  const seen = seenAt(view, of, path);
  if (seen.length > 0) await append(view, propertyRemoved(of, seen));
}

/**
 * Moves what `view.state` holds at and under `from` to `to`: every value and
 * item copied first, in the order they were added, then one `removed` of
 * `from`. A crash midway leaves both keys, never neither. Refuses a `to`
 * that already holds something, rather than merging into it. Nothing at
 * `from` writes nothing.
 */
export async function renameProperty(
  view: PropertiesView,
  of: Target,
  from: string[],
  to: string[],
): Promise<void> {
  check(view, of, from);
  check(view, of, to);
  const seen = seenAt(view, of, from);
  if (seen.length === 0) return;
  if (list(view.state, of, to).length > 0) throw new Error("That property already exists");

  const moved = (path: string[]) => [...to, ...path.slice(from.length)];
  const events: AnyBuilt[] = seen.flatMap(({ path, value, items }) => [
    ...(value === undefined ? [] : [propertySet(of, moved(path), value)]),
    ...items.map((item) => propertyItemAdded(of, moved(path), item)),
  ]);
  events.push(propertyRemoved(of, seen));
  // Every event checked before the first is written, so a refusal writes nothing.
  for (const event of events) parsed(event);
  for (const event of events) await append(view, event);
}
