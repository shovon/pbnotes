/**
 * Undo (#224, #233): the events that take a step back, and whether a step can
 * still be taken back without undoing someone else's work.
 *
 * A step is what one command wrote: the graph before it, its events, and the
 * graph after. The inverse is plain events, the same ones any writer writes,
 * so every build folds an undo correctly. Nothing here keeps a history; that
 * is the caller's.
 *
 * The fold is handed in, not imported: this slice reads the others' state and
 * builds with their builders, and the graph is where the folds meet.
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field, unnamed } from "../events/events.ts";
import { each } from "../batch/batch.ts";
import type { Batched } from "../batch/batch.ts";
import { find } from "../blocks/blocks.ts";
import type { Block, BlockState } from "../blocks/blocks.ts";
import {
  blockCreated,
  blockDeleted,
  blockEdited,
  blockIndented,
  blockOutdented,
} from "../blocks/commands.ts";
import { propertyRemoved, propertySet } from "../properties/properties.ts";
import type { PropertyState } from "../properties/properties.ts";
import { tagAdded, tagRemoved } from "../tags/tags.ts";
import type { TagState } from "../tags/tags.ts";
import { aliasAdded, aliasRemoved } from "../aliases/aliases.ts";
import type { AliasState } from "../aliases/aliases.ts";
import { titleOf } from "../titles/titles.ts";

/** What undo reads: what a user wrote, and how it is spelled. */
export type Held = BlockState & PropertyState & TagState & AliasState;

/** A fold over one event, which hands back `state` itself for one it does not read. */
export type Reduce<S> = (state: S, event: Batched) => S;

/** What one command wrote, between the graph before it and the graph after. */
export type Step<S extends Held = Held> = {
  readonly before: S;
  readonly events: readonly Batched[];
  readonly after: S;
};

// ── Reading a payload the fold has already accepted ─────────────────────────

/** A string field of a payload, or "" for anything else. */
function text(payload: unknown, name: string): string {
  if (typeof payload !== "object" || payload === null) return "";
  const value = field(payload, name);
  return typeof value === "string" ? value : "";
}

/**
 * `events` with each batch in place of what it holds, each paired with the
 * state just before it, folded forward with `reduce`. An event the fold
 * passes over (it hands back the same state) changed nothing and is left out.
 */
function walk<S>(reduce: Reduce<S>, before: S, events: readonly Batched[]): [S, Batched][] {
  const out: [S, Batched][] = [];
  let state = before;
  for (const event of each(events)) {
    const next = reduce(state, event);
    if (next !== state) out.push([state, event]);
    state = next;
  }
  return out;
}

// ── Blocks: where one sits, and putting a subtree back ──────────────────────

/** Where `block.created` puts a block back: after a sibling, under a parent, or first. */
type Place = { after?: string; parent?: string; first?: true };

/** Where the block `id` sits in `state`, as a `block.created` would put it back there. */
function placeOf(state: BlockState, id: string): Place | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const above = found.siblings[found.at - 1];
  const parent = found.parent?.id;
  if (above) return { after: above.id, ...(parent ? { parent } : {}) };
  return parent ? { parent } : { first: true };
}

/**
 * `block` and its subtree as `block.created` events, top-down, with the same
 * ids and text: the block at `place`, then each child, the first under its
 * parent and the rest after the sibling above it.
 */
function recreate(page: string, block: Block, place: Place): Batched[] {
  const out: Batched[] = [
    blockCreated(page, block.text, place.after, block.id, place.parent, place.first),
  ];
  block.children.forEach((child, at) => {
    const above = block.children[at - 1];
    out.push(...recreate(page, child, above ? { after: above.id, parent: block.id } : { parent: block.id }));
  });
  return out;
}

/** The text of the block `id`, or undefined when it is gone. */
function textOf(state: BlockState, id: string): string | undefined {
  const found = find(state, id);
  return found?.siblings[found.at].text;
}

/** Every id in `blocks`, at every depth. */
function ids(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => [block.id, ...ids(block.children)]);
}

// ── Inverting ───────────────────────────────────────────────────────────────

/**
 * The events that undo `event`, read from `state`, the graph just before it.
 * Empty when it cannot be undone from what the events say: a creation of an
 * id that was already there, or a move that is not one a command writes.
 */
function inverse(state: Held, event: Batched): Batched[] {
  const payload = event.payload;
  const id = text(payload, "id");
  const page = text(payload, "page");

  switch (unnamed(event.type)) {
    case "block.created":
      return find(state, id) ? [] : [blockDeleted(id)];

    case "block.edited": {
      const was = textOf(state, id);
      return was === undefined || was === text(payload, "text") ? [] : [blockEdited(id, was)];
    }

    case "block.deleted": {
      const found = find(state, id);
      const place = placeOf(state, id);
      return found && place ? recreate(found.page, found.siblings[found.at], place) : [];
    }

    case "block.indented": {
      // A command indents under the sibling above; coming back out after it
      // is where the block was. The block is that sibling's last child, so
      // the outdent takes nothing along with it.
      const found = find(state, id);
      const parent = text(payload, "parent");
      return found?.siblings[found.at - 1]?.id === parent
        ? [blockOutdented({ id, after: parent })]
        : [];
    }

    case "block.outdented": {
      // Back under the old parent as its last child, then each sibling the
      // outdent took along back out after it, last first, so they land in
      // their old order.
      const found = find(state, id);
      if (!found?.parent) return [];
      const along = found.siblings.slice(found.at + 1).reverse();
      return [
        blockIndented({ id, parent: found.parent.id }),
        ...along.map((sibling) => blockOutdented({ id: sibling.id, after: id })),
      ];
    }

    case "property.set":
    case "property.removed": {
      const key = text(payload, "key");
      const was = state.properties.get(canonicalize(page))?.get(canonicalize(key));
      const now = unnamed(event.type) === "property.set" ? text(payload, "value") : undefined;
      if (was === now) return [];
      return [was === undefined ? propertyRemoved(page, key) : propertySet(page, key, was)];
    }

    case "tag.added":
    case "tag.removed": {
      const tag = text(payload, "tag");
      const had = state.tags.get(canonicalize(page))?.has(canonicalize(tag)) ?? false;
      const has = unnamed(event.type) === "tag.added";
      if (had === has) return [];
      return [had ? tagAdded(page, tag) : tagRemoved(page, tag)];
    }

    case "alias.added":
    case "alias.removed": {
      const alias = text(payload, "alias");
      const had = state.aliases.get(canonicalize(page))?.has(canonicalize(alias)) ?? false;
      const has = unnamed(event.type) === "alias.added";
      if (had === has) return [];
      return [had ? aliasAdded(page, alias) : aliasRemoved(page, alias)];
    }

    case "page.deleted": {
      const key = canonicalize(page);
      const title = titleOf(state, page);
      const blocks = state.blocks.get(key) ?? [];
      return [
        ...blocks.flatMap((block, at) =>
          recreate(title, block, at === 0 ? { first: true } : { after: blocks[at - 1].id }),
        ),
        ...[...(state.properties.get(key) ?? [])].map(([name, value]) =>
          propertySet(title, titleOf(state, name), value),
        ),
        ...[...(state.tags.get(key) ?? [])].map((tag) => tagAdded(title, titleOf(state, tag))),
        ...[...(state.aliases.get(key) ?? [])].map((alias) =>
          aliasAdded(title, titleOf(state, alias)),
        ),
      ];
    }

    default:
      return [];
  }
}

/**
 * The events that undo `events`, written on `before`: the last event undone
 * first, each against the graph as it stood just before it. A batch is the
 * events it holds. Empty when nothing in `events` changed anything, or
 * nothing that changed can be put back.
 */
export function invert<S extends Held>(
  reduce: Reduce<S>,
  before: S,
  events: readonly Batched[],
): Batched[] {
  return walk(reduce, before, events)
    .reverse()
    .flatMap(([state, event]) => inverse(state, event));
}

// ── Whether a step still holds ──────────────────────────────────────────────

/** A check of one thing a step touched: whether it is in `now` as the step left it in `after`. */
type Check = (now: Held, after: Held) => boolean;

/** Where a block is: its page, parent, and the siblings either side. Undefined when it is gone. */
function position(state: Held, id: string): string | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const { siblings, at } = found;
  return JSON.stringify([
    canonicalize(found.page),
    found.parent?.id ?? null,
    siblings[at - 1]?.id ?? null,
    siblings[at + 1]?.id ?? null,
  ]);
}

/** A block's text and its whole subtree, ids and text. Undefined when it is gone. */
function tree(state: Held, id: string): string | undefined {
  const found = find(state, id);
  if (!found) return undefined;
  const shape = (block: Block): unknown => [block.id, block.text, block.children.map(shape)];
  return JSON.stringify(shape(found.siblings[found.at]));
}

/** The same in `now` as in `after`, by `read`. */
function same(read: (state: Held) => unknown): Check {
  return (now, after) => read(now) === read(after);
}

/** None of `gone` is anywhere in `now`. */
function stillGone(gone: string[]): Check {
  return (now) => gone.every((id) => !find(now, id));
}

/** What a step must find as it left it, for `event` written on `state`. */
function touched(state: Held, event: Batched): Check[] {
  const payload = event.payload;
  const id = text(payload, "id");
  const page = canonicalize(text(payload, "page"));

  switch (unnamed(event.type)) {
    case "block.created":
      // Undone, it goes with its subtree: nobody may have written under it.
      return [same((it) => tree(it, id)), same((it) => position(it, id))];

    case "block.edited":
      return [same((it) => textOf(it, id))];

    case "block.deleted": {
      const found = find(state, id);
      return found ? [stillGone(ids([found.siblings[found.at]]))] : [];
    }

    case "block.indented":
      return [same((it) => position(it, id))];

    case "block.outdented": {
      const found = find(state, id);
      const along = found ? found.siblings.slice(found.at + 1).map((it) => it.id) : [];
      return [id, ...along].map((moved) => same((it) => position(it, moved)));
    }

    case "property.set":
    case "property.removed": {
      const key = canonicalize(text(payload, "key"));
      return [same((it) => it.properties.get(page)?.get(key))];
    }

    case "tag.added":
    case "tag.removed": {
      const tag = canonicalize(text(payload, "tag"));
      return [same((it) => it.tags.get(page)?.has(tag) ?? false)];
    }

    case "alias.added":
    case "alias.removed": {
      const alias = canonicalize(text(payload, "alias"));
      return [same((it) => it.aliases.get(page)?.has(alias) ?? false)];
    }

    case "page.deleted":
      // A page that gained something since still takes its old content back
      // (#224): only what it held coming back from elsewhere stops it.
      return [stillGone(ids(state.blocks.get(page) ?? []))];

    default:
      return [];
  }
}

/**
 * Whether `step` can still be undone in `now`: everything it touched is as it
 * left it. False means someone changed it since, and undoing would undo
 * their work too. Only what the step touched is compared, so a change
 * anywhere else leaves it holding.
 */
export function holds<S extends Held>(reduce: Reduce<S>, now: S, step: Step<S>): boolean {
  return walk(reduce, step.before, step.events)
    .flatMap(([state, event]) => touched(state, event))
    .every((check) => check(now, step.after));
}
