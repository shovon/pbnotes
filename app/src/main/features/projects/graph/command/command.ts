/**
 * What arrives on `graph:command`, checked (#158). The renderer is the one
 * place main takes input it did not produce, and a command goes on to name
 * pages and blocks in a log that keeps whatever it is given forever, so its
 * shape is checked here before the session runs it. The `@pbnotes/graph`
 * command it names makes the full checks; this only stops what isn't the
 * right type from reaching it.
 *
 * Free of `electron` imports, so it runs under `node --test`.
 */
import type { Command, Pasted } from "../../../../../shared/graph.ts";
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
 * A day as the window's clock names it, `YYYY-MM-DD`: the journal's today,
 * or where the journal's list stops (#282), by `name`. Only its shape is checked;
 * which day it is belongs to the window.
 */
export function requireDay(value: unknown, name = "today"): string {
  const day = requireString(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new TypeError("Expected a day as YYYY-MM-DD");
  }
  return day;
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

/** The blocks a command on several names. An empty list names nothing, and is refused. */
function someIds(raw: Raw): string[] {
  const blockIds = requireStringArray(own(raw, "blockIds"), "blockIds");
  if (blockIds.length === 0) throw new TypeError("Expected a block");
  return blockIds;
}

/**
 * How many blocks one paste may write, and how deep they may nest. The
 * blocks come off the clipboard, which any app can write, and every one of
 * them stays in the log forever: a paste past either is refused whole, not
 * cut down to what fits.
 */
export const PASTE_LIMITS = { blocks: 10_000, depth: 100 };

/**
 * The blocks a paste writes, each built fresh from the three fields it
 * reads: a new id, checked as one; its text; and what goes under it.
 */
function requirePasted(value: unknown): Pasted[] {
  let count = 0;
  const read = (raw: unknown, depth: number): Pasted[] => {
    if (!Array.isArray(raw)) throw new TypeError("Expected blocks to be an array");
    if (depth > PASTE_LIMITS.depth) throw new TypeError("Blocks nest too deep to paste");
    return raw.map((it: unknown) => {
      if (typeof it !== "object" || it === null) throw new TypeError("Expected a block");
      count += 1;
      if (count > PASTE_LIMITS.blocks) throw new TypeError("Too many blocks to paste");
      return {
        id: requireBlockId(own(it, "id")),
        text: requireString(own(it, "text"), "text"),
        children: read(own(it, "children"), depth + 1),
        ...cutId(own(it, "was")),
      };
    });
  };
  const blocks = read(value, 1);
  if (blocks.length === 0) throw new TypeError("Expected a block");
  return blocks;
}

/**
 * The id a cut block had (#246), when it is one main would let a window
 * name. Anything else is left off, and the block is pasted as a copy: it
 * came off a clipboard any app can write, and a paste is not refused for it.
 */
function cutId(value: unknown): { was?: string } {
  try {
    return value === undefined ? {} : { was: requireBlockId(value) };
  } catch {
    return {};
  }
}

/** An optional block id field: absent, or a string. */
function optionalId(raw: Raw, name: string): Record<string, string> {
  const value = own(raw, name);
  return value === undefined ? {} : { [name]: requireString(value, name) };
}

/**
 * Where a block goes, as a paste or a move names it: `after` and `parent`
 * as optional block ids, and `first` as absent or `true`. Each is left off
 * when absent. Which combinations make sense is the graph command's to say.
 */
function requirePlace(raw: Raw): { after?: string; parent?: string; first?: true } {
  const first = own(raw, "first");
  if (first !== undefined && first !== true) throw new TypeError("Expected first to be true");
  return {
    ...optionalId(raw, "after"),
    ...optionalId(raw, "parent"),
    ...(first === true ? { first: true as const } : {}),
  };
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
      // A first child of this block (#385). Which pairs with `after` is the
      // graph command's to say, as for a move.
      ...optionalId(raw, "parent"),
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
  deleteBlocks: (raw) => ({ type: "deleteBlocks", blockIds: someIds(raw) }),
  indentBlocks: (raw) => ({ type: "indentBlocks", blockIds: someIds(raw) }),
  outdentBlocks: (raw) => ({ type: "outdentBlocks", blockIds: someIds(raw) }),
  // Where a paste goes is a place or an empty block to fill, never both:
  // the graph command would take one and the other would mean nothing.
  pasteBlocks: (raw) => {
    const place = requirePlace(raw);
    const into = optionalId(raw, "into");
    if (into.into !== undefined && Object.keys(place).length > 0) {
      throw new TypeError("A paste into a block has no other place");
    }
    return {
      type: "pasteBlocks",
      title: requireTitle(own(raw, "title")),
      blocks: requirePasted(own(raw, "blocks")),
      ...place,
      ...into,
    };
  },
  indentBlock: (raw) => ({
    type: "indentBlock",
    blockId: requireString(own(raw, "blockId"), "blockId"),
  }),
  outdentBlock: (raw) => ({
    type: "outdentBlock",
    blockId: requireString(own(raw, "blockId"), "blockId"),
  }),
  // A move names its place as a paste does, and the page it lands on as a
  // title, since a move can be the first write to that page.
  moveBlock: (raw) => ({
    type: "moveBlock",
    blockId: requireString(own(raw, "blockId"), "blockId"),
    title: requireTitle(own(raw, "title")),
    ...requirePlace(raw),
  }),
  moveBlocks: (raw) => ({
    type: "moveBlocks",
    blockIds: someIds(raw),
    title: requireTitle(own(raw, "title")),
    ...requirePlace(raw),
  }),
  // A key is a page title, and checked as one: it goes into `titles` as the
  // key page's spelling if nothing has named that page yet.
  setProperty: (raw) => ({
    type: "setProperty",
    title: requireTitle(own(raw, "title")),
    key: requireTitle(own(raw, "key")),
    value: requireString(own(raw, "value"), "value"),
  }),
  removeProperty: (raw) => ({
    type: "removeProperty",
    title: requireTitle(own(raw, "title")),
    key: requireTitle(own(raw, "key")),
  }),
  renameProperty: (raw) => ({
    type: "renameProperty",
    title: requireTitle(own(raw, "title")),
    from: requireTitle(own(raw, "from")),
    to: requireTitle(own(raw, "to")),
  }),
  // A tag is a page title too, checked as one for the same reason.
  addTag: (raw) => ({
    type: "addTag",
    title: requireTitle(own(raw, "title")),
    tag: requireTitle(own(raw, "tag")),
  }),
  removeTag: (raw) => ({
    type: "removeTag",
    title: requireTitle(own(raw, "title")),
    tag: requireTitle(own(raw, "tag")),
  }),
  // An alias is a page title too (#383), checked as one for the same reason.
  addAlias: (raw) => ({
    type: "addAlias",
    title: requireTitle(own(raw, "title")),
    alias: requireTitle(own(raw, "alias")),
  }),
  removeAlias: (raw) => ({
    type: "removeAlias",
    title: requireTitle(own(raw, "title")),
    alias: requireTitle(own(raw, "alias")),
  }),
  // An icon is any string: what it means is the window's (#322).
  setIcon: (raw) => ({
    type: "setIcon",
    title: requireTitle(own(raw, "title")),
    icon: requireString(own(raw, "icon"), "icon"),
  }),
  removeIcon: (raw) => ({
    type: "removeIcon",
    title: requireTitle(own(raw, "title")),
  }),
  deletePage: (raw) => ({
    type: "deletePage",
    title: requireTitle(own(raw, "title")),
  }),
  renamePage: (raw) => ({
    type: "renamePage",
    title: requireTitle(own(raw, "title")),
    to: requireTitle(own(raw, "to")),
  }),
  // Nothing to check: what to undo or redo is main's, never the window's to
  // say (#234). Built fresh, so nothing else the window sent goes on.
  undo: () => ({ type: "undo" }),
  redo: () => ({ type: "redo" }),
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
