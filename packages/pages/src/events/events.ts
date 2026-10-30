/**
 * What every pbnotes event looks like on the way in: a name under the
 * namespace, and a payload from a shared folder that may be anything. Both
 * folds read events through this, and neither owns it.
 */

/**
 * What every pbnotes event type starts with:
 * `github.com/shovon/pbnotes#block.created`. See #37.
 *
 * An identifier and not a link. Once a log holds it, it is on disk forever,
 * and it stays these bytes wherever the repository goes. Public contract, with
 * `HANDLES`: see the README.
 */
export const NAMESPACE = "github.com/shovon/pbnotes#";

/** An event type as it is written: under the namespace. */
export type Named<T extends string> = `${typeof NAMESPACE}${T}`;

/**
 * The name under the namespace, or undefined for a type outside it. A bare
 * `block.created` is not one of ours (#40).
 */
export function unnamed(type: string): string | undefined {
  return type.startsWith(NAMESPACE) ? type.slice(NAMESPACE.length) : undefined;
}

/** A field the payload holds itself, never one every object inherits (#62). */
export function field(payload: object, name: string): unknown {
  return Object.hasOwn(payload, name)
    ? (payload as Record<string, unknown>)[name]
    : undefined;
}
