/**
 * What arrives on `pages:command`, checked (#158). The renderer is the one
 * place main takes input it did not produce, and a command goes on to name
 * pages and blocks in a log that keeps whatever it is given forever, so its
 * shape is checked here before the session runs it. The `@pbnotes/pages`
 * command it names makes the full checks; this only stops what isn't the
 * right type from reaching it.
 *
 * Free of `electron` imports, so it runs under `node --test`.
 */
import type { Scalar, Target } from "@pbnotes/pages";
import type { Command } from "../../../../../shared/pages.ts";
import { requireString, requireStringArray } from "../../../../ipc.ts";

/**
 * A title is a key in a log that keeps everything forever, so it is checked
 * on arrival: something, and nothing loose around it. Not a date pattern any
 * more, since a link can name a page anything, but the link plugin trims what
 * it names, and a title that arrives untrimmed came from somewhere else. The
 * fold would take one; it would also keep its spelling as the page's.
 */
export function requireTitle(value: unknown): string {
  const title = requireString(value, "title");
  if (title === "" || title !== title.trim()) {
    throw new TypeError("Expected a page title");
  }
  return title;
}

/**
 * A new block's id comes from the renderer, which drew the block under it
 * before asking for it to be written. It is checked like a title, and for
 * the same reason: it is a key in a log that keeps everything forever.
 */
export function requireBlockId(value: unknown): string {
  const id = requireString(value, "id");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) {
    throw new TypeError("Expected a block id");
  }
  return id;
}

type Raw = object;

/** A field the object holds itself, never one it inherits (#62). */
function own(raw: Raw, name: string): unknown {
  return Object.hasOwn(raw, name)
    ? (raw as Record<string, unknown>)[name]
    : undefined;
}

/**
 * What a property is about, rebuilt from the fields its kind reads: the
 * builders write `of` as they are given it, so anything else the window put
 * in it would reach the log. A page's title is checked as every title is.
 */
function requireTarget(value: unknown): Target {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Expected a target");
  }
  switch (own(value, "kind")) {
    case "page":
      return { kind: "page", title: requireTitle(own(value, "title")) };
    case "block":
      return { kind: "block", id: requireString(own(value, "id"), "id") };
    default:
      throw new TypeError("Expected a target");
  }
}

/** A path's type only; the package refuses an empty one or a blank segment. */
function requirePath(value: unknown, label: string): string[] {
  return [...requireStringArray(value, label)];
}

/** A string, a number, a boolean or `null`. The package refuses a non-finite number. */
function requireScalar(value: unknown, label: string): Scalar {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
  }
  throw new TypeError(`Expected ${label} to be a string, number, boolean or null`);
}

/**
 * One checker per command type. Keyed on `Command["type"]`, so a case added
 * to the union without a checker does not compile. Each builds its command
 * fresh from the fields it reads, so nothing else the window sent goes on.
 */
const CHECKERS: {
  [T in Command["type"]]: (raw: Raw) => Extract<Command, { type: T }>;
} = {
  addBlock: (raw) => {
    const after = own(raw, "after");
    return {
      type: "addBlock",
      id: requireBlockId(own(raw, "id")),
      title: requireTitle(own(raw, "title")),
      text: requireString(own(raw, "text"), "text"),
      // Absent means the end of the page; anything else has to be a block
      // id before it reaches a log that keeps it forever.
      ...(after === undefined ? {} : { after: requireString(after, "after") }),
    };
  },
  // No title on the four below. The block id is the whole address, so there
  // is nothing to check a title against and nothing to write one into.
  editBlock: (raw) => ({
    type: "editBlock",
    blockId: requireString(own(raw, "blockId"), "blockId"),
    text: requireString(own(raw, "text"), "text"),
  }),
  deleteBlock: (raw) => ({
    type: "deleteBlock",
    blockId: requireString(own(raw, "blockId"), "blockId"),
  }),
  indentBlock: (raw) => ({
    type: "indentBlock",
    blockId: requireString(own(raw, "blockId"), "blockId"),
  }),
  outdentBlock: (raw) => ({
    type: "outdentBlock",
    blockId: requireString(own(raw, "blockId"), "blockId"),
  }),
  setProperty: (raw) => ({
    type: "setProperty",
    of: requireTarget(own(raw, "of")),
    path: requirePath(own(raw, "path"), "path"),
    value: requireScalar(own(raw, "value"), "value"),
  }),
  unsetProperty: (raw) => ({
    type: "unsetProperty",
    of: requireTarget(own(raw, "of")),
    path: requirePath(own(raw, "path"), "path"),
  }),
  addPropertyItem: (raw) => ({
    type: "addPropertyItem",
    of: requireTarget(own(raw, "of")),
    path: requirePath(own(raw, "path"), "path"),
    item: requireScalar(own(raw, "item"), "item"),
  }),
  removePropertyItem: (raw) => ({
    type: "removePropertyItem",
    of: requireTarget(own(raw, "of")),
    path: requirePath(own(raw, "path"), "path"),
    item: requireScalar(own(raw, "item"), "item"),
  }),
  removeProperty: (raw) => ({
    type: "removeProperty",
    of: requireTarget(own(raw, "of")),
    path: requirePath(own(raw, "path"), "path"),
  }),
  renameProperty: (raw) => ({
    type: "renameProperty",
    of: requireTarget(own(raw, "of")),
    from: requirePath(own(raw, "from"), "from"),
    to: requirePath(own(raw, "to"), "to"),
  }),
};

/**
 * `value` as a command, or a `TypeError`. The type is looked up with
 * `Object.hasOwn`, so `__proto__`, `constructor` and the like are unknown
 * commands, not lookups.
 */
export function requireCommand(value: unknown): Command {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Expected a command");
  }
  const type = own(value, "type");
  if (typeof type !== "string" || !Object.hasOwn(CHECKERS, type)) {
    throw new TypeError("Unknown command");
  }
  return CHECKERS[type as Command["type"]](value);
}
