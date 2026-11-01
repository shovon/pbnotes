/**
 * Writing properties: a command per change, each checking the page's
 * properties before it builds and dispatches. The events are the builders in
 * `properties.ts`; this is what decides whether to write one.
 *
 * Every command refuses what the fold would skip, so nothing is written that
 * folds to nothing, and writes nothing for a change that changes nothing, so
 * the log does not collect events that mean nothing.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { getProperties, propertyRemoved, propertySet } from "./properties.ts";
import type { Property, PropertyEvent, PropertyState } from "./properties.ts";

/**
 * What the commands need: the state as it stands, and a way to append one of
 * this fold's events. `PagesView` is one.
 */
export type PropertiesView = {
  readonly state: PropertyState;
  /** Resolves once the event is durable and folded into `state`. */
  dispatch(v: number, type: PropertyEvent["type"], payload: unknown): Promise<unknown>;
};

function append(
  view: PropertiesView,
  event: ReturnType<typeof propertySet | typeof propertyRemoved>,
): Promise<unknown> {
  return view.dispatch(event.v, event.type, event.payload);
}

/** `page`'s value for `key` as the fold holds it, or undefined for none. */
function valueOf(state: PropertyState, page: string, key: string): string | undefined {
  return state.properties.get(canonicalize(page))?.get(canonicalize(key));
}

/** The fold's rule for a page or a key: something, once trimmed. */
function requireName(name: string, what: string): void {
  if (name.trim() === "") throw new Error(`A property needs a ${what}`);
}

/**
 * `page`'s `key` is now `value`. Setting the value the key already has writes
 * nothing. Hands back the page's properties as they then stand.
 */
export async function setProperty(
  view: PropertiesView,
  page: string,
  key: string,
  value: string,
): Promise<Property[]> {
  requireName(page, "page");
  requireName(key, "key");
  if (valueOf(view.state, page, key) !== value) {
    await append(view, propertySet(page, key, value));
  }
  return getProperties(view.state, page);
}

/** `page` no longer has `key`. Removing a key it does not have writes nothing. */
export async function removeProperty(
  view: PropertiesView,
  page: string,
  key: string,
): Promise<Property[]> {
  requireName(page, "page");
  requireName(key, "key");
  if (valueOf(view.state, page, key) !== undefined) {
    await append(view, propertyRemoved(page, key));
  }
  return getProperties(view.state, page);
}

/**
 * `page`'s `from` becomes `to`, keeping its value: a `set` of `to`, then a
 * `removed` of `from`, in that order, so a stop between the two leaves both
 * keys and never neither.
 *
 * Refuses a `from` the page does not have, and a `to` it already has rather
 * than overwrite that property's value. A `to` that is `from` once
 * canonicalized is the same key, and writes nothing: its spelling is the
 * page's, not the property's.
 */
export async function renameProperty(
  view: PropertiesView,
  page: string,
  from: string,
  to: string,
): Promise<Property[]> {
  requireName(page, "page");
  requireName(to, "key");
  const value = valueOf(view.state, page, from);
  if (value === undefined) throw new Error("No such property");
  if (canonicalize(from) !== canonicalize(to)) {
    if (valueOf(view.state, page, to) !== undefined) {
      throw new Error("That property already exists");
    }
    // dispatch appends before it folds, so the `set` is on disk before the
    // `removed` is written.
    await append(view, propertySet(page, to, value));
    await append(view, propertyRemoved(page, from));
  }
  return getProperties(view.state, page);
}
