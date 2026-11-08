/**
 * Renaming a page (#108): what a rename does to the graph, the state it keeps,
 * and the reads around it. The event is in `events/pages/renamed/`, and the
 * command is `commands.ts`.
 *
 * One event, `page.renamed { from, to }`, and the fold does all of it, so a
 * rename never appends a `block.edited` per linking block: an edit replaces a
 * block's whole text, and one that sorted after a concurrent edit on another
 * device would wipe that edit out. A rewrite in the fold applies to whatever
 * text is there at its place in fold order.
 *
 * A rename that changes the key moves the page and everything on it, leaves
 * the old name as an alias, rewrites what points at the old name (links,
 * tags and property keys on every page), and from then on sends a write on
 * the old name to the page it became, for as long as that alias stands. A
 * rename that only changes case or Unicode form changes how the page is
 * spelled, and nothing else (#89).
 */
import { canonicalize } from "../canonicalize/canonicalize.ts";
import { field } from "../events/events.ts";
import * as forest from "../forest/forest.ts";
import * as map from "../immutable/immutable.ts";
import type { ImmutableMap } from "../immutable/immutable.ts";
import { DATE_PATTERN, dateOf, namesOf } from "../journal/journal.ts";
import { read } from "../reading/reading.ts";
import { relink } from "../relink/relink.ts";
import { spell, titleOf } from "../titles/titles.ts";
import type { Titles } from "../titles/titles.ts";
import { answersTo, claims } from "../aliases/aliases.ts";
import type { AliasState } from "../aliases/aliases.ts";
import { hasContent } from "../deletes/deletes.ts";
import type { Holds as DeleteHolds } from "../deletes/deletes.ts";
import type { EditedState } from "../edited/edited.ts";

/**
 * Each name a rename left behind, by key → the key of the page it became.
 * A name is redirected while that page still answers to it (`redirect`):
 * removing the alias ends it. A day leaves no name behind.
 */
export type RenameState = {
  readonly renames: ImmutableMap<string>;
};

/** What a rename folds over: everything on a page, what points at it, and when it changed. */
export type Holds = DeleteHolds & RenameState & EditedState;

/** The page `from` is now called `to`. */
export type PageRenamed = { from: string; to: string };

/**
 * A rename payload as this build reads it, or undefined when it is
 * malformed: not an object, or a `from` or `to` that is not a string or is
 * blank once trimmed. Any other field is ignored.
 */
export function readRenamed(payload: unknown): PageRenamed | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const from = field(payload, "from");
  const to = field(payload, "to");
  const named = (it: unknown): it is string => typeof it === "string" && it.trim() !== "";
  return named(from) && named(to) ? { from, to } : undefined;
}

/** The key a rename files a title under: the day a date name means, or the title's own. */
export function keyFor(title: string): string {
  return dateOf(title) ?? canonicalize(title);
}

/** Whether `key` is a journal day. */
const isDay = (key: string) => DATE_PATTERN.test(key);

/**
 * The page a write on `page` goes to instead, by key: the page a rename
 * made of it, while that page still answers to it. Undefined for a name no
 * rename left behind, or whose alias was removed since.
 */
export function redirect(state: RenameState & AliasState, page: string): string | undefined {
  const at = canonicalize(page);
  const to = map.get(state.renames, at);
  return to !== undefined && answersTo(state, to, at) ? to : undefined;
}

/**
 * What a rename does at this point in fold order:
 *
 * - `spell`: the keys are the same and the spelling is new, so it changes how the page is shown.
 * - `move`: the page and everything on it go to `to`, and what links to it follows. A page with nothing on it is renamed too: every page already exists, and the links to it are what there is to rename.
 * - `nothing`: the spelling is already `to`, a day's case changed, `from` is empty and nothing names it (there is nothing to rename) or another page claims it as an alias, `to` has content of its own, or `to` is a name a rename sends to another page. The first holds the second of two renames of one page: the first left `from` empty and claimed by the page it became. The rename that sorts first wins, and nothing is merged without being asked (#110).
 */
export function outcome(state: Holds, { from, to }: PageRenamed): "spell" | "move" | "nothing" {
  const was = keyFor(from);
  const now = keyFor(to);
  if (was === now) return isDay(now) || titleOf(state, now) === to ? "nothing" : "spell";
  if (hasContent(state, now)) return "nothing";
  if (!hasContent(state, was) && (claims(state).has(was) || !namedBy(state, was))) return "nothing";
  const taken = redirect(state, now);
  return taken === undefined || taken === was ? "move" : "nothing";
}

/**
 * Whether anything names the page at `key`, as a rename rewrites it: a link
 * in a block, a tag on a page, or a property key. For a day, by any of its
 * date names too.
 */
export function namedBy(state: Holds, key: string): boolean {
  const names = new Set([key, ...namesOf(key).map(canonicalize)]);
  const named = (page: string) => names.has(canonicalize(page));
  for (const [, text] of map.entries(state.texts)) if (read(text).links.some(named)) return true;
  for (const [, set] of map.entries(state.tags)) if ([...set].some((it) => names.has(it))) return true;
  for (const [, props] of map.entries(state.properties)) if ([...props.keys()].some((it) => names.has(it))) return true;
  return false;
}

/** `held` with the entry at `from` moved to `to`. Nothing is at `to` already (`outcome`). */
function moved<V>(held: ImmutableMap<V>, from: string, to: string): ImmutableMap<V> {
  const it = map.get(held, from);
  return it === undefined ? held : map.put(map.remove(held, from), to, it);
}

/** Every value in `held` that `pick` changes, changed. */
function each<V>(held: ImmutableMap<V>, pick: (value: V) => V): ImmutableMap<V> {
  let next = held;
  for (const [key, value] of map.entries(held)) {
    const changed = pick(value);
    if (changed !== value) next = map.put(next, key, changed);
  }
  return next;
}

/** `set` with any name in `names` as `to` instead: `set` itself when it holds none. */
function renamedIn(set: Set<string>, names: Set<string>, to: string): Set<string> {
  if (![...set].some((it) => names.has(it))) return set;
  return new Set([...set].map((it) => (names.has(it) ? to : it)));
}

/**
 * A page's properties with a key in `names` as `to` instead, value kept, in
 * place. A page that already has `to` keeps both as they are rather than
 * lose either value.
 */
function rekeyed(props: Map<string, string>, names: Set<string>, to: string): Map<string, string> {
  if (props.has(to) || ![...props.keys()].some((it) => names.has(it))) return props;
  return new Map([...props].map(([key, value]) => [names.has(key) ? to : key, value] as const));
}

/**
 * The graph with `from` renamed to `to`, as `outcome` says. Hands back
 * `state` itself when it does nothing. See the module comment.
 */
export function rename<S extends Holds>(state: S, it: PageRenamed): S {
  const does = outcome(state, it);
  if (does === "nothing") return state;
  const was = keyFor(it.from);
  const now = keyFor(it.to);
  if (does === "spell") return { ...state, titles: map.put(state.titles, now, it.to) };

  // The names whose links, tags and keys now name `to`: the old title, and a day's date names.
  const names = new Set([was, ...namesOf(was).map(canonicalize)]);
  const named = (page: string) => names.has(canonicalize(page));

  let texts = state.texts;
  for (const [id, text] of map.entries(state.texts)) {
    if (read(text).links.some(named)) texts = map.put(texts, id, relink(text, named, it.to));
  }

  // The page answers to the old name, and to what it answered to before,
  // unless the new name was one of those: a page never answers to itself.
  const answers = new Set(map.get(state.aliases, was));
  if (!isDay(was)) answers.add(was);
  answers.delete(now);
  const aliases = map.remove(state.aliases, was);

  let renames = each(map.remove(state.renames, now), (to) => (to === was ? now : to));
  if (!isDay(was)) renames = map.put(renames, was, now);

  const edited = map.get(state.edited, was);
  const titles = isDay(now) ? spell(state.titles, [it.from]) : map.put(spell(state.titles, [it.from]), now, it.to);

  return {
    ...state,
    forest: forest.regroup(state.forest, was, now),
    texts,
    properties: each(moved(state.properties, was, now), (props) => rekeyed(props, names, now)),
    tags: each(moved(state.tags, was, now), (set) => renamedIn(set, names, now)),
    icons: moved(state.icons, was, now),
    aliases: answers.size === 0 ? aliases : map.put(aliases, now, answers),
    renames,
    edited: edited === undefined ? state.edited : map.put(map.remove(state.edited, was), now, edited),
    titles,
  };
}

/**
 * Every name a rename left behind that is still redirected, by key: the
 * names search leaves out, since they are a safety net and a renamed typo
 * should not keep being offered.
 */
export function renamedAway(state: RenameState & AliasState): Set<string> {
  return new Set([...map.keys(state.renames)].filter((key) => redirect(state, key) !== undefined));
}

/** A name a rename left behind, and the title of the page it became. */
export type Renamed = { from: string; to: string };

/**
 * Each of `names` that a rename left behind, with the title of the page it
 * became, as it shows: what a reader holding the old name should hold
 * instead. Following a chain of renames, it is the page at its end. A name
 * no rename left behind is not in the answer: one that names a page of its
 * own, an alias someone added, a name whose alias was removed since, and a
 * day, which leaves no name behind. Each name once, as it was given.
 */
export function renamedTo(
  state: RenameState & AliasState & { readonly titles: Titles },
  names: readonly string[],
): Renamed[] {
  const seen = new Set<string>();
  const found: Renamed[] = [];
  for (const from of names) {
    if (seen.has(from)) continue;
    seen.add(from);
    const to = redirect(state, from);
    if (to !== undefined) found.push({ from, to: titleOf(state, to) });
  }
  return found;
}
