import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { locate, canonicalize, today } from '@pbnotes/graph';
import type { Block } from '@pbnotes/graph';
import { CARRY_LIMIT } from '../../../shared/graph';
import type { Act } from '../../ui';
import type { ProjectViewGraph } from '../ProjectView';
import { Previews } from '../Block/Block';
import PageView from '../PageView/PageView';
import { imageTarget, placeNew } from '../placement/placement';
import { ALL_PAGES, go, placeOf, rezoom } from '../trail/trail';
import type { Stop } from '../trail/trail';
import { samePlace } from '../held/held';
import type { Held } from '../held/held';
import { createFetcher } from '../fetcher/fetcher';
import AllPages from '../AllPages/AllPages';
import type { Sort } from '../AllPages/sort/sort';
import PageMenu from '../PageMenu/PageMenu';
import { deletedSince } from '../deleted/deleted';
import { renamedSince } from '../renamed/renamed';
import { Selecting } from '../selection/Selecting';
import type { FromBox } from '../selection/Selecting';
import { every, extend, follow as followShown, move, pick, span, toggle as flip } from '../selection/selection';
import type { Selection } from '../selection/selection';
import {
  dropRows as readDropRows,
  emptyPages as readEmptyPages,
  rows as readRows,
  shown as readShown,
  columnAt,
  columnOf,
  scrollerOf,
  beside as besideScope,
} from '../selection/shown';
import { watchDrag } from '../selection/sweep/watch';
import { THRESHOLD } from '../selection/sweep/sweep';
import { watchGesture } from '../gesture/gesture';
import type { Point } from '../gesture/gesture';
import { Dragging } from '../drag/Dragging';
import { dropAt } from '../drag/drop/drop';
import type { Drop } from '../drag/drop/drop';
import type { Entry } from '../selection/shown';
import { covered, roots } from '../selection/roots/roots';
import { command, picks } from '../selection/shortcut/shortcut';
import { decode } from '../selection/clip/clip';
import { inColumn } from '../column/column';
import Aside from '../Aside/Aside';
import Card from '../Aside/Card/Card';
import type { Shown as CardShown } from '../Aside/Card/Card';
import { unshelve } from '../Aside/stack/stack';
import type { Clipped } from '../selection/clip/clip';
import { asText, dataUrl, imageNames, picked } from '../selection/copy/copy';
import { asHtml } from '../selection/copy/html/html';
import { beneath, endOf, landed, withIds } from '../selection/paste/paste';
import type { Spot } from '../selection/paste/paste';
import { withField } from './state/state';
import { whereFrom } from '../opening/opening';
import type { Where } from '../opening/opening';
import type { TabState, Target } from './state/state';

/** The image files in a paste or a drop. */
const images = (data: DataTransfer): File[] =>
  [...data.files].filter((file) => file.type.startsWith('image/'));

/** Whether `element` is somewhere text is typed, which takes a paste as its own. */
const typesText = (element: Element | null): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLElement && element.isContentEditable);

type Props = {
  act: Act;
  /** The bridge to main, handed down from `ProjectView`, and on to each page. */
  graph: ProjectViewGraph;
  /** The clock, for which day a drop with no page lands on. */
  now: () => Date;
  /** Whether this is macOS: Cmd selects and copies there, Ctrl elsewhere. */
  mac: boolean;
  /** What the tab keeps while it is not drawn (`state/`). */
  tab: TabState;
  /** Steps `tab`: what it is now in, what it is to be out. */
  update: (step: (tab: TabState) => TabState) => void;
  /** A click on a page: Shift held (`beside`) keeps it in the aside. */
  onOpen: (page: string, where: Where) => void;
  /** Opens the page a block is on and brings the block into view. */
  onBlock: (id: string, where?: Where) => void;
  /** The page `from` is now called `to`: wherever else the window holds it. */
  onRenamed: (from: string, to: string) => void;
  /** The page `gone` was deleted: off it, wherever the window holds it. */
  onDeleted: (gone: string) => void;
  /**
   * What the tab left behind when it was last drawn (#303), or null when
   * it never was: the view it drew, to draw again at once and to tell the
   * next answer against, and how far the window was scrolled.
   */
  resume: { held: Held | null; scroll: number } | null;
  /** Each view the tab draws, for the window to keep while it is not drawn. */
  onHeld: (held: Held) => void;
};

/**
 * One tab of a project: one place, what shows there, and what is open
 * beside it. By default the journal: every day that has anything on it,
 * newest first, with today at the top. Follow a link and it is that one
 * page instead.
 *
 * Where the tab is looking is its own (`tab`, held by `ProjectView` so it
 * outlives the tab being drawn): the trail of places followed, stepped here
 * and never sent anywhere. What shows at the end of it is main's — the
 * graph: pages and what links to them — and the tab asks for it whenever it
 * moves, and whenever main says the fold has. It keeps the one answer it is
 * drawing and nothing to hold in step.
 *
 * ponytail: the whole history renders at once. Add windowing when someone has
 * enough years in one project for that to show.
 */
export default function Tab({
  act,
  graph,
  now,
  mac,
  tab,
  update,
  onOpen,
  onBlock,
  onRenamed,
  onDeleted,
  resume,
  onHeld,
}: Props) {
  const { trail, sort, aside, asideWidth, target } = tab;
  const setTrail = (take: (trail: Stop[]) => Stop[]) =>
    update((tab) => withField(tab, 'trail', take(tab.trail)));
  const setSort = (sort: Sort) => update((tab) => withField(tab, 'sort', sort));
  const setAside = (take: (aside: string[]) => string[]) =>
    update((tab) => withField(tab, 'aside', take(tab.aside)));
  const setAsideWidth = (width: number) => update((tab) => withField(tab, 'asideWidth', width));
  const setTarget = (target: Target | null) => update((tab) => withField(tab, 'target', target));

  /**
   * Where the tab is. A journal stop (`home`) and an empty trail are both
   * the journal: `place` is undefined on either, and on the list of every
   * page (`browse`), which is on no page either.
   */
  const place = placeOf(trail.at(-1));
  const browsing = trail.at(-1) === ALL_PAGES;
  /**
   * What is drawn, and the place it was asked for. Null until main first
   * answers. It can be a step behind the trail while the next place is being
   * asked for, which is why everything drawn reads its place from here.
   */
  const [held, setHeld] = useState<Held | null>(resume?.held ?? null);
  /** The name the view was asked for: what the trail holds, as the link spelt it. */
  const asked = held?.place?.page ?? null;
  /**
   * The page the view is on, as it shows, or null for the journal. Not
   * always `asked`: an alias or a date name opens another page (#221), and a
   * write, an image or a link back to it is about that page.
   */
  const title = asked === null ? null : (held?.view.showing[0]?.page.title ?? asked);
  /** The block the view is zoomed into, when it is. */
  const zoom = held?.place?.block;
  /** `held`'s version, or 0 before the first answer. */
  const version = held?.view.version ?? 0;

  /** Where the tab is when an answer lands, not when it was asked for. */
  const latest = useRef(place);
  latest.current = place;

  /**
   * The view last drawn, to tell the next one against: a page deleted while
   * the tab is on it (`deleted/`). Read where the answer lands, not in an
   * effect, so the step off the page is taken in the same render as the
   * answer, before anything else reacts to what is now missing from it.
   */
  const shown = useRef<Held | null>(resume?.held ?? null);
  /** `onHeld` as of this render, for the fetcher made once. */
  const heldUp = useRef(onHeld);
  heldUp.current = onHeld;
  /** Pages this tab is deleting itself: it has left them already. */
  const deleting = useRef(new Set<string>());
  /** What to do about a page deleted elsewhere; rebound each render. */
  const deletedElsewhere = useRef<(title: string) => void>(() => undefined);
  deletedElsewhere.current = (gone) => {
    if (deleting.current.has(canonicalize(gone))) return;
    onDeleted(gone);
    act(async () => {
      throw new Error(`“${gone}” was deleted in another window or on another device.`);
    });
  };

  /**
   * The page `from` is now called `to` (#109): the window reads `to`
   * wherever it held `from` (`onRenamed`), so the tab moves with the page.
   * Silent, and the same whoever renamed it: this tab, or another window or
   * machine (`renamed/`). Each step hands back what it was given when
   * nothing changes, so following twice is following once.
   */
  const followRename = useRef<(from: string, to: string) => void>(() => undefined);
  followRename.current = onRenamed;

  /**
   * When to ask main what shows here, and which answer to draw (`fetcher/`).
   * A failure goes through `act`, so a project that cannot be reached still
   * says so; the fetch itself does not, since it is not a gesture and runs
   * on every change from anywhere.
   */
  const [fetcher] = useState(() =>
    createFetcher({
      view: (at, from) => graph.view(at, today(now()), from),
      where: () => latest.current,
      onAnswer: (next) => {
        const gone = deletedSince(shown.current, next);
        const moved = renamedSince(shown.current, next);
        shown.current = next;
        setHeld(next);
        heldUp.current(next);
        if (gone !== undefined) deletedElsewhere.current(gone);
        if (moved !== undefined) {
          // The trail holds the name the tab asked by, which may be an
          // alias or a date name rather than the title.
          followRename.current(moved.from, moved.to);
          if (next.place) followRename.current(next.place.page, moved.to);
        }
      },
      onError: (error) => act(() => Promise.reject(error)),
      start: resume?.held,
    }),
  );

  /** A step the user took: through `act`, like every other gesture. */
  const step = (take: (trail: Stop[]) => Stop[]) => act(async () => setTrail(take));

  // On mount, and every time the tab moves. On mount it picks up its list
  // where it left it (#303), so the journal does not shrink under where it
  // was scrolled. By the place last asked for, not a first-run flag: in
  // development React runs a mount's effects twice, for the same place.
  const askedFor = useRef<{ at: typeof place } | null>(null);
  useEffect(() => {
    const moved = askedFor.current !== null && !samePlace(askedFor.current.at, place);
    askedFor.current = { at: place };
    if (moved) fetcher.moved();
    else fetcher.resumed();
  }, [place?.page, place?.block]);

  /**
   * Below the view while its list has more to load: the journal's older
   * days (#282), or a page's next linked references (#285), which start
   * once the page's own blocks are drawn. Coming within a couple of screens
   * of view asks for them. Observed afresh with every view, so a marker
   * still in reach once more is drawn asks again; a drag held at the
   * window's edge scrolls it into reach too.
   */
  const older = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const marker = older.current;
    if (!marker) return;
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((it) => it.isIntersecting)) fetcher.more();
      },
      { rootMargin: '0px 0px 200% 0px' },
    );
    seen.observe(marker);
    return () => seen.disconnect();
  }, [held]);

  /**
   * What each card in the aside (#287) draws, by canonical title: for a
   * copy of blocks selected in one. Each card is a page view of its own,
   * inside this tab's, so selecting, dragging and following a link work
   * there as they do on the page.
   */
  const [asideShown, setAsideShown] = useState<ReadonlyMap<string, CardShown>>(new Map());
  const closeCard = (page: string) => setAside((stack) => unshelve(stack, page));
  /**
   * Only the cards still open: one closed, or opened again under a new name
   * after a rename (#301), leaves nothing of what it drew behind.
   */
  useEffect(() => {
    setAsideShown((all) => {
      const open = new Set(aside.map(canonicalize));
      if ([...all.keys()].every((key) => open.has(key))) return all;
      return new Map([...all].filter(([key]) => open.has(key)));
    });
  }, [aside]);

  useEffect(() => {
    // A notice and a write's reply take one path, so this tab's writes
    // reach the screen the way every other change does.
    const off = graph.onChanged(fetcher.heard);
    // A stubbed bridge — Storybook's — answers with something that is not an
    // unsubscribe, and a cleanup that is not a function throws.
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  /** The bridge handed to each page: a write's reply is heard here too. */
  const bridge = useMemo<ProjectViewGraph>(
    () => ({
      ...graph,
      run: async (command) => {
        const v = await graph.run(command);
        if (typeof v === 'number') fetcher.heard(v);
        return v;
      },
    }),
    [graph],
  );

  const previews = useMemo(() => new Map(held?.view.previews), [held?.view.previews]);

  /**
   * To the top on navigation only. A day rolling over mid-session, or another
   * device's notes landing, re-reads the page under someone who is reading it;
   * moving them to the top of it would be a second surprise on top of the
   * first.
   *
   * Above the scroll to a block, and it has to stay there: when the two land
   * in one render, effects run in this order and the block has the last word.
   *
   * Drawn again (#303), the tab goes back to where the window was scrolled
   * on it instead, until it first moves: the view it left is drawn already,
   * so the page is as tall. By what it first drew, not a first-run flag, as
   * the fetch above is.
   */
  const firstDrawn = useRef<string | null>(null);
  const navigated = useRef(false);
  useEffect(() => {
    const key = JSON.stringify([asked, zoom ?? null, browsing]);
    firstDrawn.current ??= key;
    if (key !== firstDrawn.current) navigated.current = true;
    const back = !navigated.current && resume?.held && samePlace(resume.held.place, place);
    window.scrollTo(0, back ? resume.scroll : 0);
  }, [asked, zoom, browsing]);

  /**
   * Makes a block the root of the view: what its dot does. Looked up in main
   * like `onBlock`, because a dot in a cut belongs to a page that is not
   * the one showing.
   */
  const zoomTo = (id: string) =>
    act(async () => {
      const found = await graph.locate(id);
      if (!found) throw new Error('That block no longer exists.');
      setTrail((trail) => go(trail, { page: found.page, block: id }));
    });

  /**
   * After the page is drawn, not on the step: the block is not in the DOM
   * until main has answered for the new place and the page has rendered.
   * Cleared either way, so a block that is open in an editor — which carries
   * no hook — is not scrolled to on some later render.
   */
  useEffect(() => {
    if (target === null || !held || !samePlace(held.place, place)) return;
    if (held.view.version < target.version) return;
    setTarget(null);
    const element = document.querySelector(
      `[data-block-id="${CSS.escape(target.id)}"]`,
    );
    if (!element) return;
    element.scrollIntoView({ block: 'center' });
    element.animate(
      [
        {
          backgroundColor:
            'color-mix(in srgb, var(--color-accent) 25%, transparent)',
        },
        { backgroundColor: 'transparent' },
      ],
      { duration: 1500, easing: 'ease-out' },
    );
  }, [target, held]);

  /**
   * The zoomed block is not on its page: another device deleted it, or back
   * came round to one deleted since. The page it was on is the nearest thing
   * left, with a notice so the view did not just change by itself. A delete
   * made here never gets this far — the page zooms out before it writes.
   */
  const zoomed = zoom ? held?.view.showing[0]?.page : undefined;
  useEffect(() => {
    if (!zoom || !zoomed || locate(zoomed.blocks, zoom)) return;
    // Already on its way somewhere else: nothing to move.
    if (!samePlace(held?.place, place)) return;
    setTrail((trail) => rezoom(trail));
    act(async () => {
      throw new Error('That block no longer exists.');
    });
  }, [zoom, zoomed]);

  /**
   * The title edited in place (#109): `from` renamed to `to`, and the window
   * goes with it once main has written it. By the title and by the name the
   * view was asked for, which may be an alias or a date name: a day renamed
   * away leaves no alias, so the window has to move itself. Not through
   * `act`: the title shows a refusal under itself, and keeps what was typed.
   */
  const renamePage = async (from: string, to: string) => {
    const by = asked;
    await bridge.run({ type: 'renamePage', title: from, to });
    followRename.current(from, to);
    if (by !== null) followRename.current(by, to);
  };

  /**
   * The ⋯ menu's delete, once confirmed. Off the page first, back past every
   * stop on it (`leave`), then the write: the view this tab asks for next
   * is wherever it landed, never the page that is going.
   */
  const deletePage = (gone: string) =>
    act(async () => {
      const key = canonicalize(gone);
      deleting.current.add(key);
      onDeleted(gone);
      try {
        await bridge.run({ type: 'deletePage', title: gone });
      } finally {
        // The notice of it reaches this tab before the reply does.
        deleting.current.delete(key);
      }
    });

  /** The page on show, for its ⋯ menu: its own view, not under a zoom. */
  const own =
    held?.place && !held.place.block && samePlace(held.place, place)
      ? held.view.showing[0]
      : undefined;

  /**
   * Every wikilink in every block lands here, in the capture phase, before
   * the block it sits in can turn the click into an edit. Stopping it there
   * is what keeps the editor closed: React's bubbling `onClick` on the block
   * never runs. The page is read off the attribute, not `href` — that one
   * comes back absolute and percent-encoded.
   */
  const follow = (event: React.MouseEvent) => {
    // Cmd/Ctrl+click on a link opens it in a new tab (#309), left behind
    // this one, and shown at once with Shift too: a wikilink (a tag and a
    // property's link are wikilinks too), or a rendered `((id))`, whose page
    // opens with the block in view. Before the selection below, which takes
    // every other Cmd/Ctrl+click on a block. A dot is a block ref too, but
    // not a link: Cmd/Ctrl+click on it still selects.
    const target = event.target as Element;
    const rendered = target.closest('.block-ref[data-block-ref]')?.getAttribute('data-block-ref');
    const linked = target.closest('a.wikilink[href]')?.getAttribute('href')?.slice(1);
    const where = whereFrom(event, mac);
    if ((rendered || linked) && (where === 'tab' || where === 'background')) {
      event.preventDefault();
      event.stopPropagation();
      boxAtDown.current = null;
      if (rendered) onBlock(rendered, where);
      else if (linked) onOpen(linked, where);
      return;
    }
    // Cmd/Ctrl+click on a block selects it, or takes it out (#253), before
    // anything in it is followed or opened. With a box open, that block is
    // selected too, having written what was typed, as blur does.
    const at = (event.target as Element).closest<HTMLElement>('[data-slot]');
    const key = at?.dataset.slot;
    if (key && picks(event, mac)) {
      event.preventDefault();
      event.stopPropagation();
      openBox()?.blur();
      const box = boxAtDown.current ?? openBox()?.closest<HTMLElement>('[data-slot]')?.dataset.slot;
      boxAtDown.current = null;
      const order = onScreen().map((it) => it.key);
      setChosen((it) =>
        box ? (box === key ? pick(key) : flip(pick(box), key, order)) : flip(it, key, order),
      );
      return;
    }
    // A block ref, by the id it carries: a dot, or a rendered `((id))`.
    // A rendered ref goes to the block where it sits; a dot, or a crumb
    // above a zoomed block, zooms into it.
    const mark = (event.target as Element).closest('[data-block-ref]');
    const ref = mark?.getAttribute('data-block-ref');
    if (mark && ref) {
      event.preventDefault();
      event.stopPropagation();
      if (mark.matches('.block-ref')) onBlock(ref);
      else zoomTo(ref);
      return;
    }
    const link = (event.target as Element).closest('a.wikilink[href]');
    const page = link?.getAttribute('href')?.slice(1);
    if (!page) return;
    event.preventDefault();
    // Shift+click keeps the page open beside this one (#287), wherever the
    // link is, a card's own blocks included.
    if (event.shiftKey) {
      event.stopPropagation();
      onOpen(page, 'beside');
      return;
    }
    // A link to the page already open goes nowhere, so there is no
    // navigation here to keep the editor closed for: let the click through
    // to the block, which opens it. Every block listed under a page holds
    // one of these by construction, so in a cut it is the common case —
    // swallowed, the most obvious thing on screen to click did nothing.
    // Zoomed in, the same link is the way out to the whole page.
    if (title !== null && canonicalize(page) === canonicalize(title) && !zoom) return;
    event.stopPropagation();
    step((trail) => go(trail, { page }));
  };

  const wrapper = useRef<HTMLDivElement>(null);

  /**
   * The blocks selected (#253), across every page on screen, and a block
   * whose box Enter on them opens. The order a selection runs in is the order
   * the blocks show, read off the screen each time (`selection/shown.ts`):
   * every day, and every linked reference under one, in one line.
   */
  const [chosen, setChosenState] = useState<Selection | null>(null);
  /**
   * The selection as of the last change, not the last render: a second key
   * pressed before React draws the first one's result builds on it.
   */
  const latestChosen = useRef<Selection | null>(null);
  const setChosen = (
    next: Selection | null | ((it: Selection | null) => Selection | null),
  ) => {
    const it = typeof next === 'function' ? next(latestChosen.current) : next;
    latestChosen.current = it;
    setChosenState(it);
  };
  const [opening, setOpening] = useState<{ scope: string; id: string } | null>(null);
  const onScreen = () => readShown(wrapper.current);
  /** The box that was open when a Cmd/Ctrl+click went down, which it selects too. */
  const boxAtDown = useRef<string | null>(null);

  /** The slot of the box being written in, if there is one. */
  const openBox = (): HTMLElement | null => {
    const active = document.activeElement;
    return active instanceof HTMLTextAreaElement && wrapper.current?.contains(active)
      ? active
      : null;
  };

  /**
   * Shift+Up and Shift+Down, over what shows: the head stops only where a
   * press shows something new, so not under a block already selected.
   */
  const grow = (selection: Selection, entries: Entry[], by: 1 | -1): Selection => {
    const order = entries.map((it) => it.key);
    const under = covered(entries, selection.keys);
    const steps = order.filter((key) => key === selection.head || !under.has(key));
    return extend(selection, order, by, steps);
  };

  /** Every block in the view `key` shows in: Cmd+A. */
  const everyBeside = (key: string): Selection | null => {
    const entries = onScreen();
    const scope = entries.find((it) => it.key === key)?.scope;
    return every(entries.filter((it) => it.scope === scope).map((it) => it.key));
  };

  /** A box handing over to a selection: it has written what was typed and is closing. */
  const fromBox = (key: string, how: FromBox) => {
    const entries = onScreen();
    const here = pick(key);
    // A block just written is not drawn yet: it is selected alone.
    if (!entries.some((it) => it.key === key)) return setChosen(here);
    if (how === 'up' || how === 'down') {
      return setChosen(grow(here, entries, how === 'up' ? -1 : 1));
    }
    setChosen(how === 'all' ? (everyBeside(key) ?? here) : here);
  };

  /**
   * The keys, with blocks selected. In the capture phase on the window, so a
   * block with focus (one Cmd+clicked) does not take Enter as its own.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const chosen = latestChosen.current;
      // A drag going on, to select or to move, has its own Escape, and
      // nothing else moves the selection under it.
      if (!chosen || event.isComposing || dragged.current || draggingBlock.current) return;
      const it = command(event, mac);
      if (!it) return;
      event.preventDefault();
      event.stopPropagation();
      const entries = onScreen();
      const order = entries.map((entry) => entry.key);
      if (it.kind === 'move') setChosen(move(chosen, order, it.by));
      else if (it.kind === 'extend') setChosen(grow(chosen, entries, it.by));
      else if (it.kind === 'all') setChosen(everyBeside(chosen.anchor) ?? chosen);
      else if (it.kind === 'clear') setChosen(null);
      else if (it.kind === 'delete') removing.current();
      else if (it.kind === 'indent') moving.current('indentBlocks');
      else if (it.kind === 'outdent') moving.current('outdentBlocks');
      else {
        const first = entries.find((entry) => entry.key === chosen.keys[0]);
        setChosen(null);
        if (first) setOpening({ scope: first.scope, id: first.id });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mac]);

  /**
   * A click without Cmd or Ctrl clears the selection, wherever it lands, and
   * so does anything taking focus to type in: opening a box, the finder, a
   * property. A Cmd/Ctrl+click notes the box it closes, which `follow` reads.
   */
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      // Ctrl+click on macOS is a right-click: its menu acts on the selection.
      if (event.button !== 0 || (mac && event.ctrlKey)) return;
      if (picks(event, mac)) {
        boxAtDown.current = openBox()?.closest<HTMLElement>('[data-slot]')?.dataset.slot ?? null;
        return;
      }
      // A dot may be the start of a drag (#269), which leaves the selection
      // to say what it moves. A click on it zooms, and what the zoom hides
      // drops out of the selection then.
      if (event.target instanceof Element && event.target.closest('[data-dot]')) return;
      setChosen(null);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (typing) setChosen(null);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, [mac]);

  /**
   * Dragging across blocks selects them (#262): from a blank area beside or
   * below them at once, and from a block's row, open or not, once the
   * pointer reaches another row. Cmd/Ctrl+drag adds to what is selected. The
   * blank area is the page's surroundings, which are what holds `wrapper`:
   * never the sidebar or the titlebar beside it. A dot is left for dragging
   * the block (#251), and a link, an image or a control for its own use.
   */
  const dragged = useRef<{ base: readonly string[]; before: Selection | null } | null>(null);
  useEffect(() => {
    const root = wrapper.current;
    if (!root) return;
    return watchDrag<{ start: string | undefined; add: boolean; column: string }>({
      // The column it went down in (#305): the page and a card beside it
      // share heights, and a sweep down one never touches the other.
      rows: ({ column }) => inColumn(readRows(root), column),
      scroller: ({ column }) => scrollerOf(root, column),
      press: (event) => {
        // Ctrl+click on macOS is a right-click.
        if (mac && event.ctrlKey) return undefined;
        const target = event.target;
        if (!(target instanceof Element)) return undefined;
        const around = !root.contains(target) && target.contains(root);
        if (!around && !root.contains(target)) return undefined;
        const row = target.closest<HTMLElement>('[data-slot]')?.dataset.slot;
        const own = target.closest(
          '[data-block-ref], a, img, button, input, select, [contenteditable="true"], [role="button"]:not([data-block-id]), [role="separator"]',
        );
        if (own) return undefined;
        if (target.closest('textarea') && row === undefined) return undefined;
        return { start: row, add: picks(event, mac), column: columnOf(target) };
      },
      start: (add) => {
        const before = latestChosen.current;
        dragged.current = { base: add ? (before?.keys ?? []) : [], before };
      },
      sweep: (run) => {
        const drag = dragged.current;
        if (!drag) return;
        const order = onScreen().map((it) => it.key);
        setChosen(run ? span(drag.base, run.anchor, run.head, order) : every(drag.base));
      },
      cancel: () => {
        setChosen(dragged.current?.before ?? null);
        dragged.current = null;
      },
      end: () => {
        dragged.current = null;
      },
    });
  }, [mac]);

  /**
   * Dragging a block by its dot moves it, with everything under it (#251):
   * on its page, into a linked reference, which puts it on that page, or
   * onto another journal day, a day with no blocks yet among them. A line
   * shows where it will land, and how far it is indented shows how deep.
   * Escape, or letting go away from every block, moves nothing. A click on
   * the dot without a drag still zooms in. Not drawn ahead of main: the
   * block can land on another page, which this window may show in another
   * view, so it moves when main's next view arrives, as a selection's
   * writes do.
   *
   * The dot of a selected block drags the whole selection (#269): its
   * top-most blocks, which land together, in the order they show. Any
   * other dot drags its block alone, and the selection stays as it was.
   * After a drop within the view every moved block was in, the selection
   * stays on them there; after one into another view it is dropped.
   */
  const [drop, setDrop] = useState<Drop | null>(null);
  /**
   * What is being dragged: the slots every page view draws faded, each with
   * its subtree, and the pressed block's first line, which follows the
   * pointer so it is plain what is moving, with how many more go with it.
   * The pointer is in client coordinates.
   */
  const [dragging, setDragging] = useState<{
    keys: readonly string[];
    text: string;
    more: number;
    at: Point;
  } | null>(null);
  const draggingKeys = useMemo(() => new Set(dragging?.keys), [dragging?.keys]);
  /** A block drag is on: the selection's keys leave Escape to it. */
  const draggingBlock = useRef(false);
  const moveTo = (blockIds: string[], selection: boolean, from: string[], { page, scope, place }: Drop) => {
    // The moved blocks stay selected only where every one of them was:
    // anywhere else, what is left of the selection would be a part of it.
    if (selection && !from.every((it) => it === scope)) setChosen(null);
    act(() => bridge.run({ type: 'moveBlocks', blockIds, title: page, ...place }));
  };
  const movingTo = useRef(moveTo);
  movingTo.current = moveTo;
  useEffect(() => {
    const root = wrapper.current;
    if (!root) return;
    let latest: Drop | undefined;
    const stop = () => {
      latest = undefined;
      draggingBlock.current = false;
      setDrop(null);
      setDragging(null);
      delete document.documentElement.dataset.draggingBlock;
    };
    type Press = {
      ids: string[];
      keys: string[];
      /** The view each block dragged shows in. */
      scopes: string[];
      selection: boolean;
      text: string;
      indent: number;
    };
    return watchGesture<Press>({
      press: (event) => {
        // Ctrl+click on macOS is a right-click.
        if (mac && event.ctrlKey) return undefined;
        const target = event.target;
        const dot = target instanceof Element ? target.closest<HTMLElement>('[data-dot]') : null;
        const id = dot?.dataset.blockRef;
        const slot = dot?.closest<HTMLElement>('[data-slot]');
        const key = slot?.dataset.slot;
        const scope = slot?.dataset.slotScope;
        if (!dot || !id || !key || scope === undefined || !root.contains(dot)) return undefined;
        const box = slot.querySelector<HTMLElement>('[data-block-id]');
        const text = box?.innerText.trim().split('\n')[0] ?? '';
        // The dot is one level wide, whatever the font size.
        const indent = dot.getBoundingClientRect().width;
        const chosen = latestChosen.current;
        if (chosen?.keys.includes(key)) {
          const picked = roots(onScreen(), chosen.keys);
          return {
            ids: picked.map((it) => it.id),
            keys: [...chosen.keys],
            scopes: picked.map((it) => it.scope),
            selection: true,
            text,
            indent,
          };
        }
        return { ids: [id], keys: [key], scopes: [scope], selection: false, text, indent };
      },
      begins: (_, from, to) => Math.hypot(to.x - from.x, to.y - from.y) >= THRESHOLD,
      start: ({ ids, keys, text }) => {
        draggingBlock.current = true;
        // A closed hand, over everything, for as long as the drag lasts
        // (`index.css`): a block's own cursor would win over the page's.
        document.documentElement.dataset.draggingBlock = '';
        setDragging({ keys, text, more: ids.length - 1, at: { x: -1000, y: -1000 } });
      },
      move: ({ ids, keys, text, indent }, to) => {
        setDragging({ keys, text, more: ids.length - 1, at: to });
        const x = to.x + window.scrollX;
        const y = to.y + window.scrollY;
        // Into the column under the pointer (#305), so a block dragged over a
        // card lands in it, and one over the page beside it in the page.
        const column = columnAt(to.x, to.y);
        latest = dropAt(
          inColumn(readDropRows(root), column),
          inColumn(readEmptyPages(root), column),
          new Set(ids),
          x,
          y,
          indent,
        );
        setDrop(latest ?? null);
      },
      cancel: stop,
      end: ({ ids, selection, scopes }, dropped) => {
        const it = latest;
        stop();
        if (dropped && it) movingTo.current(ids, selection, scopes, it);
      },
      // The column under the pointer scrolls near its edges, not always the
      // window: the right sidebar scrolls on its own (#305).
      scroller: (_, at) => scrollerOf(root, columnAt(at.x, at.y)),
    });
  }, [mac]);

  /** What shows has changed: what is gone drops out of the selection. */
  useEffect(() => {
    setChosen((it) => it && followShown(it, onScreen().map((entry) => entry.key)));
  }, [held, browsing, asideShown]);

  /** Up and Down keep the block they reach in sight. */
  useEffect(() => {
    if (!chosen) return;
    document
      .querySelector(`[data-slot="${CSS.escape(chosen.head)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [chosen?.head]);

  const selected = useMemo(() => new Set(chosen?.keys), [chosen]);
  /**
   * Delete or Backspace with blocks selected, or Delete N Blocks from a
   * selected dot's menu (#258): the top-most selected blocks go, each with
   * its subtree, as one write and one undo step, and the selection clears.
   * Main works out which of them another holds, for the blocks a linked
   * reference shows without their parent. Not drawn ahead of main: the
   * blocks can be on several pages, each its own page view. The zoomed
   * block going zooms out first, to what it hung under, as Delete Block's
   * does, so the view is never rooted on nothing.
   */
  const removeChosen = () => {
    const blockIds = takeChosen();
    if (blockIds.length > 0) act(() => removeBlocks(blockIds));
  };
  /** The selection's top-most blocks, and the selection cleared. */
  const takeChosen = (): string[] => {
    const chosen = latestChosen.current;
    if (!chosen) return [];
    const blockIds = roots(onScreen(), chosen.keys).map((it) => it.id);
    setChosen(null);
    return blockIds;
  };
  /**
   * `blockIds`, each with its subtree, deleted as one step, the zoom moved
   * out first when the zoomed block is one of them.
   */
  const removeBlocks = async (blockIds: string[]) => {
    const zoomed = zoom ? held?.view.showing[0]?.page : undefined;
    if (zoom && zoomed && blockIds.includes(zoom)) {
      setTrail((trail) => rezoom(trail, locate(zoomed.blocks, zoom)?.parent?.id));
    }
    await bridge.run({ type: 'deleteBlocks', blockIds });
  };
  /** `removeChosen` as of this render, for the key listener set up once. */
  const removing = useRef(removeChosen);
  removing.current = removeChosen;

  /**
   * Tab (#259) and Shift+Tab (#260) with blocks selected: each top-most
   * selected block goes under the sibling above it, or comes out a level, in
   * the order they show, as one write and one undo step, or none of them
   * does when one cannot move, wherever it is. The selection stays, so a
   * second press moves them again: a slot is a block in a view, and an
   * indent or an outdent keeps both.
   */
  const moveChosen = (type: 'indentBlocks' | 'outdentBlocks') => {
    const chosen = latestChosen.current;
    if (!chosen) return;
    const blockIds = roots(onScreen(), chosen.keys).map((it) => it.id);
    if (blockIds.length > 0) act(() => bridge.run({ type, blockIds }));
  };
  const moving = useRef(moveChosen);
  moving.current = moveChosen;

  /**
   * How many blocks a delete of the selection takes, when `slot` is one of
   * them: its dot's menu then deletes them all. Undefined for a slot that is
   * not selected, whose menu acts on its block alone.
   */
  const deletingOf = (slot: string): number | undefined => {
    const chosen = latestChosen.current;
    return chosen?.keys.includes(slot) ? roots(onScreen(), chosen.keys).length : undefined;
  };

  /**
   * Cmd/Ctrl+C, or Edit → Copy, with blocks selected (#261): the top-most
   * selected blocks, each with its subtree and once, as main last sent them,
   * go on the clipboard as a Markdown list, as HTML with the project's images
   * carried in it, and as blocks riding in that HTML for a paste into
   * pbnotes. The selection stays. Read off every page and cut on screen,
   * since a selection spans them, and written by main.
   */
  const copyChosen = () => {
    const chosen = latestChosen.current;
    if (!chosen) return;
    const blocks = shownBlocks(roots(onScreen(), chosen.keys).map((it) => it.id));
    if (blocks.length > 0) act(() => toClipboard(blocks, false));
  };
  /**
   * `blockIds`, each with its subtree and once, as main last sent them: read
   * off every page and cut on screen, since a selection spans them.
   */
  const shownBlocks = (blockIds: string[]): Block[] => {
    if (!held) return [];
    const trees = [
      ...held.view.showing.flatMap(({ page, references }) => [
        page.blocks,
        ...references.map((it) => it.blocks),
      ]),
      ...[...asideShown.values()].map((it) => it.page.blocks),
    ];
    return picked(trees, blockIds);
  };
  /**
   * `blocks` on the clipboard, as a copy or, with `cut`, with each block's
   * id riding along (#246), so the first paste of them puts them back.
   */
  const toClipboard = async (blocks: Block[], cut: boolean) => {
    const fetched = await Promise.all(
      imageNames(blocks, previews).map(async (name) => [name, await graph.image(name)] as const),
    );
    // Up to the limit an image travels in the copy (#261). Past it, it is
    // left out, and a block's own image is reached through a token for
    // this project instead, which only this running app can follow.
    const small = fetched.flatMap(([name, image]) =>
      image && image.bytes.length <= CARRY_LIMIT ? [[name, dataUrl(image)] as const] : [],
    );
    const own = new Set(imageNames(blocks, new Map()));
    const big = fetched.some(
      ([name, image]) => image && image.bytes.length > CARRY_LIMIT && own.has(name),
    );
    const source = big ? await graph.imageSource() : undefined;
    await graph.copy({
      text: asText(blocks, previews),
      html: asHtml(blocks, previews, new Map(small), source, cut),
    });
  };
  const copying = useRef(copyChosen);
  copying.current = copyChosen;

  /**
   * Cut (#246): the blocks go on the clipboard as a copy does, each with its
   * id, and are then deleted, as one step. The first paste of them puts
   * the very blocks back, so every `((id))` to them works again; a later
   * paste is a copy. Nothing is deleted unless the clipboard took them.
   */
  const cutBlocks = (blockIds: string[]) => {
    const blocks = shownBlocks(blockIds);
    if (blocks.length === 0) return;
    act(async () => {
      await toClipboard(blocks, true);
      await removeBlocks(blocks.map((it) => it.id));
    });
  };
  /** Cmd/Ctrl+X, or Edit → Cut, with blocks selected: the selection, cut. */
  const cutChosen = () => cutBlocks(takeChosen());
  const cutting = useRef(cutChosen);
  cutting.current = cutChosen;
  const cuttingOne = useRef(cutBlocks);
  cuttingOne.current = cutBlocks;

  /** The cut event, as the copy event: Cmd/Ctrl+X and the menu's Cut both raise it. */
  useEffect(() => {
    const onCut = (event: ClipboardEvent) => {
      if (!latestChosen.current || typesText(document.activeElement)) return;
      event.preventDefault();
      cutting.current();
    };
    document.addEventListener('cut', onCut);
    return () => document.removeEventListener('cut', onCut);
  }, []);

  /**
   * The copy event, not the key: Cmd/Ctrl+C and the menu's Copy both raise
   * it. With blocks selected nothing is being typed, since a field taking
   * focus clears the selection, so the copy is theirs.
   */
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      if (!latestChosen.current || typesText(document.activeElement)) return;
      event.preventDefault();
      copying.current();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  /**
   * Blocks from a pbnotes copy, pasted with no box open (#261): beneath the
   * last selected block, at its depth, or with none selected where a pasted
   * image goes, at the end of what is in view. New blocks, named here, as
   * one write and one undo step, once the images they link are in this
   * project. A box open takes the paste itself (`PageView`).
   */
  const pasteHere = (clipped: Clipped, html: string) => {
    const chosen = latestChosen.current;
    const last = chosen ? roots(onScreen(), chosen.keys).at(-1) : undefined;
    const zoomed = zoom ? held?.view.showing[0]?.page : undefined;
    const found = zoom && zoomed ? locate(zoomed.blocks, zoom) : undefined;
    const target = last
      ? { page: last.page, spot: beneath(last.id, found?.siblings[found.at]) as Spot }
      : (() => {
          const { page, root } = imageTarget({
            title,
            today: today(now()),
            showing: held?.view.showing.map((it) => it.page) ?? [],
            zoom,
          });
          return { page, spot: endOf(root) };
        })();
    act(async () => {
      const pasting = withIds(await landed(graph, clipped, html), () => crypto.randomUUID());
      await bridge.run({ type: 'pasteBlocks', title: target.page, blocks: pasting, ...target.spot });
    });
  };

  const selecting = useMemo<Selecting>(
    () => ({
      mac,
      selected,
      opening,
      onOpened: () => setOpening(null),
      fromBox,
      deleting: deletingOf,
      removeChosen: () => removing.current(),
      cut: (slot, id) =>
        latestChosen.current?.keys.includes(slot) ? cutting.current() : cuttingOne.current([id]),
    }),
    // `fromBox` and `deletingOf` read only refs and setters.
    [mac, selected, opening],
  );

  /**
   * Puts pasted or dropped images into the notes: each is stored in the
   * project's folder, and its link goes in one of two places.
   *
   * With a block open, at the end of that block as a paragraph of its own —
   * not at the caret, which can be in the middle of a sentence or a code
   * block, and the end is the same place every time. Written into the box
   * like typing: it is committed, or discarded, with the rest of the box.
   *
   * With none open, or one that closed while the file was being stored, as a
   * new block last on the page: the page dropped on, else the one showing,
   * else today. Zoomed, last under the zoomed block, as a box at the end of
   * that view writes — the end of the page would be out of sight.
   */
  const placeImages = (files: File[], dropped?: string) => {
    const active = document.activeElement;
    const box =
      active instanceof HTMLTextAreaElement && wrapper.current?.contains(active)
        ? active
        : null;
    const { page: to, root } = imageTarget({
      dropped,
      title,
      today: today(now()),
      showing: held?.view.showing.map((it) => it.page) ?? [],
      zoom,
    });
    // The last one written, so a second lands beneath the first.
    let last: string | undefined;
    act(async () => {
      for (const file of files) {
        const link = await graph.addImage(
          new Uint8Array(await file.arrayBuffer()),
          file.type,
        );
        const text = `![](${link})`;
        if (box?.isConnected) {
          box.value = [box.value.trimEnd(), text].filter(Boolean).join('\n\n');
          continue;
        }
        // The first under a root with no children: written beside it, then
        // filed under it, like the box at the end of a zoom in `PageView`.
        const { after, indent } = placeNew(root, last);
        const id = crypto.randomUUID();
        await bridge.run({ type: 'addBlock', id, title: to, text, ...(after ? { after } : {}) });
        last = id;
        if (indent) await bridge.run({ type: 'indentBlock', blockId: id });
      }
    });
  };

  /**
   * On the document, not the view: with no box open the paste has nothing
   * focused to land on, and arrives at the body. Subscribed again each
   * render, so it places by the state as it is now.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data || event.defaultPrevented) return;
      // A box, or any field, takes blocks as its own: into a box they are
      // `PageView`'s, and into anything else the text they also carry.
      const html = data.getData('text/html');
      const clipped = typesText(document.activeElement) ? undefined : decode(html);
      if (clipped) {
        event.preventDefault();
        pasteHere(clipped, html);
        return;
      }
      // Text copied out of a word processor comes with a picture of itself.
      // That is a paste of text.
      if (!data || ['text/plain', 'text/html'].every((it) => data.types.includes(it))) {
        return;
      }
      const files = images(data);
      if (files.length === 0) return;
      event.preventDefault();
      placeImages(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const onDrop = (event: React.DragEvent) => {
    const files = images(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    placeImages(
      files,
      (event.target as Element).closest<HTMLElement>('[data-page]')?.dataset.page,
    );
  };

  /**
   * Right-click on a block ref opens its menu instead of the browser's.
   * Anywhere else is left alone, so text keeps its cut/copy/paste. A
   * right-click never fires `click`, so `follow` stays out of it on its own.
   *
   * Bubbling, not capture: a dot or a crumb is its page's to answer, since
   * the page is what can delete a block, and it has already taken the event
   * by the time it gets here. What reaches this is a rendered `((id))`,
   * which only copies — deleting through a ref would delete a block from
   * wherever it is, out of sight.
   */
  const blockMenu = (event: React.MouseEvent) => {
    if (event.defaultPrevented) return;
    const ref = (event.target as Element)
      .closest('[data-block-ref]')
      ?.getAttribute('data-block-ref');
    if (!ref) return;
    event.preventDefault();
    void graph.blockMenu(ref);
  };

  return (
    <>
      <div
        ref={wrapper}
        onClickCapture={follow}
        // Shift+click on a link opens it beside (#287): not a run of text
        // selected up to it on the way down.
        onMouseDown={(event) => {
          if (event.shiftKey && (event.target as Element).closest('a.wikilink[href]')) {
            event.preventDefault();
          }
          // Cmd/Ctrl on a link opens a tab and leaves this one as it is
          // (#309): the press does not take the focus, so a box being
          // written stays open, and it starts no drag of the link either.
          const where = whereFrom(event, mac);
          if (
            (where === 'tab' || where === 'background') &&
            (event.target as Element).closest('a.wikilink[href], .block-ref[data-block-ref]')
          ) {
            event.preventDefault();
          }
        }}
        onContextMenu={blockMenu}
        // A drop is only offered where `dragover` was refused its default.
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={onDrop}
      >
        {browsing && (
          // The journal is still asked for underneath, as on an empty trail:
          // it is what back from a list that started the trail lands on.
          <AllPages
            graph={graph}
            sort={sort}
            onSort={setSort}
            onOpen={(page, keys) => onOpen(page, whereFrom(keys, mac))}
            onError={(error) => act(() => Promise.reject(error))}
          />
        )}

        {!browsing && own && (
          <PageMenu
            title={own.page.title}
            canDelete={own.page.blocks.length > 0 || own.properties.length > 0}
            impact={{
              // Every link, not only the cuts loaded so far (#285).
              links: own.links,
              refs: own.refsTo,
            }}
            graph={graph}
            onDelete={() => deletePage(own.page.title)}
            act={act}
          />
        )}

        <Selecting.Provider value={selecting}>
        <Dragging.Provider value={draggingKeys}>
        <Previews value={previews}>
          {browsing ? null : held === null ? (
            <p className="mt-1 text-sm text-muted">Loading…</p>
          ) : (
            held.view.showing.map(({ page, references, links, properties, tags, taggedBy, icon }) => (
              // Keyed by the title, so a page is never handed another page's
              // editor state — the open box and the block id in it belong to
              // the page they were opened on. The element is only a name on
              // everything the page shows, for a drop to read; it has no box.
              <div key={page.title} data-page={page.title} className="contents">
                <PageView
                  graph={bridge}
                  page={page}
                  version={version}
                  // Not under a zoom: what links to one block is #2's.
                  references={zoom ? undefined : references}
                  links={links}
                  taggedBy={zoom ? undefined : taggedBy}
                  properties={properties}
                  tags={tags}
                  icon={icon ?? null}
                  zoom={zoom}
                  onZoom={(block) => step((trail) => rezoom(trail, block))}
                  // No title is the journal: each day heads one of many.
                  linked={title === null}
                  onRename={(to) => renamePage(page.title, to)}
                  act={act}
                />
              </div>
            ))
          )}
        </Previews>
        {/* Inside the view, so a card's blocks are selected, dragged and
            followed like the page's. */}
        {aside.length > 0 && (
          <Aside width={asideWidth} onResize={setAsideWidth}>
            {aside.map((page) => (
              // By canonical title, so a card is never handed another
              // page's editor state, as the pages on the left are not.
              <Card
                key={canonicalize(page)}
                graph={graph}
                title={page}
                now={now}
                scope={besideScope(page)}
                onClose={() => closeCard(page)}
                onShown={(it) =>
                  setAsideShown((all) => new Map(all).set(canonicalize(page), it))
                }
                act={act}
              />
            ))}
          </Aside>
        )}
        </Dragging.Provider>
        {!browsing && held?.view.list?.next && (
          <p ref={older} className="mt-1 text-sm text-muted">
            {held.place ? 'Loading more linked references…' : 'Loading older days…'}
          </p>
        )}
        </Selecting.Provider>
        {/* Where a dragged block will land (#251), over everything, in page
            coordinates: the body is what it is placed against. */}
        {drop &&
          createPortal(
            <div
              aria-hidden
              className="pointer-events-none absolute z-50 h-0.5 rounded-full bg-accent"
              style={{
                top: drop.line.top - 1,
                left: drop.line.left,
                width: drop.line.right - drop.line.left,
              }}
            />,
            document.body,
          )}
        {/* What is being dragged, beside the pointer: its first line. */}
        {dragging &&
          createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-50 max-w-64 truncate rounded-sm border border-accent bg-bg px-2 py-0.5 text-sm shadow-md"
              style={{ top: dragging.at.y + 12, left: dragging.at.x + 12 }}
            >
              {dragging.text || '…'}
              {dragging.more > 0 && <span className="ml-1.5 text-muted">+{dragging.more}</span>}
            </div>,
            document.body,
          )}
      </div>
    </>
  );
}

