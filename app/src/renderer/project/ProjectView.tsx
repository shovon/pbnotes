import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { locate, canonicalize, today } from '@pbnotes/graph';
import type { GraphApi, Undone } from '../../shared/graph';
import type { Act } from '../ui';
import { Previews } from './Block/Block';
import PageView from './PageView/PageView';
import type { PageViewGraph } from './PageView/PageView';
import { imageTarget, placeNew } from './placement/placement';
import { ALL_PAGES, back, browse, go, home, label, leave, placeOf, rezoom } from './trail/trail';
import type { Stop } from './trail/trail';
import { samePlace } from './held/held';
import type { Held } from './held/held';
import { createFetcher } from './fetcher/fetcher';
import Finder from './Finder/Finder';
import AllPages from './AllPages/AllPages';
import { INITIAL } from './AllPages/sort/sort';
import type { Sort } from './AllPages/sort/sort';
import PageMenu from './PageMenu/PageMenu';
import { deletedSince } from './deleted/deleted';
import { opensFinder } from './Finder/shortcut/shortcut';
import Sidebar from './Sidebar/Sidebar';
import Toggle from './Sidebar/Toggle/Toggle';
import { forget, visit } from './Sidebar/recent/recent';
import { togglesSidebar } from './Sidebar/shortcut/shortcut';
import { createDispatcher } from './undo/dispatcher/dispatcher';
import { watchFields } from './undo/fields';
import { landing } from './undo/landing/landing';
import type { Fields } from './undo/fields';
import { OwnEdit } from './undo/own-edit';
import { Selecting } from './selection/Selecting';
import type { FromBox } from './selection/Selecting';
import { every, extend, follow as followShown, move, pick, span, toggle as flip } from './selection/selection';
import type { Selection } from './selection/selection';
import { rows as readRows, shown as readShown } from './selection/shown';
import { watchDrag } from './selection/sweep/watch';
import type { Entry } from './selection/shown';
import { covered, roots } from './selection/roots/roots';
import { command, picks } from './selection/shortcut/shortcut';

/**
 * The part of the bridge a project calls: what it calls itself, and what each
 * page it shows does.
 */
export type ProjectViewGraph = PageViewGraph &
  Pick<
    GraphApi,
    | 'onChanged'
    | 'onTake'
    | 'view'
    | 'locate'
    | 'find'
    | 'pages'
    | 'addImage'
    | 'pageMenu'
  >;

/**
 * One value kept for this project: what the view calls, and nothing else of
 * where it is kept. `App` hands these in, one per mounted view.
 */
export type Kept<T> = {
  /** What was kept last, or undefined if nothing was (or it was lost). */
  load(): Promise<T | undefined>;
  /** Keeps `value` in place of what was there. */
  save(value: T): void;
};

/**
 * A project, in one of two shapes. By default the journal: every day that has
 * anything on it, newest first, with today at the top. Follow a link and it
 * is that one page instead, with a way back to the journal above it.
 *
 * Where the window is looking is this view's own: the trail of places
 * followed, stepped here and never sent anywhere. What shows at the end of
 * it is main's — the graph: pages and what links to them — and this view asks for
 * it whenever it moves, and whenever main says the fold has. It keeps the
 * one answer it is drawing and nothing to hold in step. A project change
 * remounts it (`App` keys it by project), so the trail starts over at the
 * journal without anyone being told.
 *
 * ponytail: the whole history renders at once. Add windowing when someone has
 * enough years in one project for that to show.
 */
/** The image files in a paste or a drop. */
const images = (data: DataTransfer): File[] =>
  [...data.files].filter((file) => file.type.startsWith('image/'));

type Props = {
  act: Act;
  /** The bridge to main, handed down from `index.tsx`, and on to each page. */
  graph: ProjectViewGraph;
  /** The clock, for which day a drop with no page lands on. */
  now: () => Date;
  /**
   * Whether this is macOS: Cmd+K opens the finder there and Cmd+\\ toggles
   * the sidebar, Ctrl elsewhere.
   */
  mac: boolean;
  /** The pages opened lately in this project, newest first. */
  recentPages: Kept<string[]>;
  /** Whether this project's sidebar is collapsed. */
  sidebar: Kept<{ collapsed: boolean }>;
};

export default function ProjectView({ act, graph, now, mac, recentPages, sidebar }: Props) {
  /**
   * Where the window is, as how it got there. Empty is the journal, and so is
   * a journal stop (`home`): `place` is undefined on either, and on the list
   * of every page (`browse`), which is on no page either.
   */
  const [trail, setTrail] = useState<Stop[]>([]);
  const place = placeOf(trail.at(-1));
  const browsing = trail.at(-1) === ALL_PAGES;
  /** How the list of every page is sorted: kept here, so back to it finds it as it was. */
  const [sort, setSort] = useState<Sort>(INITIAL);
  /**
   * What is drawn, and the place it was asked for. Null until main first
   * answers. It can be a step behind the trail while the next place is being
   * asked for, which is why everything drawn reads its place from here.
   */
  const [held, setHeld] = useState<Held | null>(null);
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

  /** Where the window is when an answer lands, not when it was asked for. */
  const latest = useRef(place);
  latest.current = place;

  /**
   * The view last drawn, to tell the next one against: a page deleted while
   * the window is on it (`deleted/`). Read where the answer lands, not in an
   * effect, so the step off the page is taken in the same render as the
   * answer, before anything else reacts to what is now missing from it.
   */
  const shown = useRef<Held | null>(null);
  /** Pages this window is deleting itself: it has left them already. */
  const deleting = useRef(new Set<string>());
  /** What to do about a page deleted elsewhere; rebound each render. */
  const deletedElsewhere = useRef<(title: string) => void>(() => undefined);
  deletedElsewhere.current = (gone) => {
    if (deleting.current.has(canonicalize(gone))) return;
    setTrail((trail) => leave(trail, gone));
    setRecent((recent) => ({ ...recent, list: forget(recent.list, gone) }));
    act(async () => {
      throw new Error(`“${gone}” was deleted in another window or on another device.`);
    });
  };

  /**
   * When to ask main what shows here, and which answer to draw (`fetcher/`).
   * A failure goes through `act`, so a project that cannot be reached still
   * says so; the fetch itself does not, since it is not a gesture and runs
   * on every change from anywhere.
   */
  const [fetcher] = useState(() =>
    createFetcher({
      view: (at) => graph.view(at, today(now())),
      where: () => latest.current,
      onAnswer: (next) => {
        const gone = deletedSince(shown.current, next);
        shown.current = next;
        setHeld(next);
        if (gone !== undefined) deletedElsewhere.current(gone);
      },
      onError: (error) => act(() => Promise.reject(error)),
    }),
  );

  /** A step the user took: through `act`, like every other gesture. */
  const step = (take: (trail: Stop[]) => Stop[]) =>
    act(async () => setTrail(take));

  // On mount, and every time the window moves.
  useEffect(fetcher.moved, [place?.page, place?.block]);

  /**
   * The pages opened lately (`Sidebar/recent/`). Empty, and saved nowhere,
   * until what was kept has loaded: saving before then would put a list of
   * one over the one kept. When it lands, the page on screen goes first, so
   * a page opened while it loaded is not lost.
   */
  const [recent, setRecent] = useState<{ loaded: boolean; list: string[] }>({
    loaded: false,
    list: [],
  });
  /** The list as it loaded, so loading alone saves nothing back. */
  const loadedList = useRef<string[] | null>(null);
  useEffect(() => {
    let live = true;
    void recentPages.load().then((kept) => {
      if (!live) return;
      const page = latest.current?.page;
      const list = kept ?? [];
      loadedList.current = list;
      setRecent({ loaded: true, list: page === undefined ? list : visit(list, page) });
    });
    return () => {
      live = false;
    };
  }, [recentPages]);

  /**
   * Every page the window lands on, however it got there: a link, the
   * finder, the sidebar, back, a block's page, a zoom (its page), or where a
   * delete left it. Watching where the window is covers every step there is
   * and every one added later. The journal is not a page, and not recorded.
   */
  useEffect(() => {
    const page = place?.page;
    if (page === undefined) return;
    setRecent((recent) => (recent.loaded ? { ...recent, list: visit(recent.list, page) } : recent));
  }, [place?.page]);

  // Kept after each change, and only once loaded. `visit` and `forget` hand
  // back the same list when nothing moved, so this runs only on a change;
  // the list just loaded is not one, so opening a project writes nothing.
  useEffect(() => {
    if (recent.loaded && recent.list !== loadedList.current) recentPages.save(recent.list);
  }, [recent.list]);

  /**
   * Whether the sidebar is hidden. Showing until what was kept has loaded,
   * and when nothing was. A toggle before it lands wins over it.
   */
  const [collapsed, setCollapsed] = useState(false);
  const toggled = useRef(false);
  useEffect(() => {
    let live = true;
    void sidebar.load().then((kept) => {
      if (live && kept && !toggled.current) setCollapsed(kept.collapsed);
    });
    return () => {
      live = false;
    };
  }, [sidebar]);
  /** The button and the shortcut both; rebound each render, for `collapsed`. */
  const toggle = useRef(() => undefined as void);
  toggle.current = () => {
    toggled.current = true;
    const next = !collapsed;
    setCollapsed(next);
    sidebar.save({ collapsed: next });
  };

  /**
   * Undo (#247): the menu's Undo and Redo, and the browser's own undo from
   * any field, go to one dispatcher. The open field's history first, then
   * main's, through `act`, so a refused undo lands in the app's notice.
   *
   * Main's answer (#248): the window goes to where the step happened and
   * flashes its block, once the view holds the undo. When undo stopped, it
   * goes there too and the notice says why, thrown as `act` reports any
   * failed action. Nothing is drawn ahead: what an undo writes is main's.
   */
  const [fields, setFields] = useState<Fields | null>(null);
  useEffect(() => {
    const dispatcher = createDispatcher((way) =>
      act(async () => {
        // Main answers undo and redo with an `Undone` (`Reply` in
        // `shared/graph.ts`); the page view's `run` is typed for every write.
        const it = landing((await graph.run({ type: way })) as Undone);
        const { page, block, version, say } = it;
        if (page !== undefined) setTrail((trail) => go(trail, { page }));
        if (block !== undefined) setTarget({ id: block, version });
        if (say !== undefined) throw new Error(say);
      }),
    );
    const watched = watchFields(document, dispatcher, () => now().getTime());
    const off = graph.onTake((way) => (way === 'undo' ? dispatcher.undo() : dispatcher.redo()));
    setFields(watched);
    return () => {
      // A stubbed bridge (Storybook's) answers with something that is not an
      // unsubscribe.
      if (typeof off === 'function') off();
      watched.stop();
    };
  }, [graph]);

  useEffect(() => {
    // A notice and a write's reply take one path, so this window's writes
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
   * Read after the first commit rather than during render: on the very first
   * one the header has not been put in the DOM yet.
   */
  const [titlebar, setTitlebar] = useState<Element | null>(null);
  useEffect(() => setTitlebar(document.getElementById('titlebar')), []);
  /** The slot `App` leaves first in that strip, before the picker. */
  const [titlebarStart, setTitlebarStart] = useState<Element | null>(null);
  useEffect(() => setTitlebarStart(document.getElementById('titlebar-start')), []);

  /**
   * To the top on navigation only. A day rolling over mid-session, or another
   * device's notes landing, re-reads the page under someone who is reading it;
   * moving them to the top of it would be a second surprise on top of the
   * first.
   *
   * Above the scroll to a block, and it has to stay there: when the two land
   * in one render, effects run in this order and the block has the last word.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [asked, zoom, browsing]);

  /**
   * A block to scroll to and flash once its page has rendered, and the
   * version the view has to hold first: an undo's (#248), so a block it
   * brought back is drawn before it is looked for. 0 for a block already
   * there.
   */
  const [target, setTarget] = useState<{ id: string; version: number } | null>(null);

  /**
   * Opens the page a block is on, the way a wikilink does, and brings the
   * block into view. A block that is gone lands in the app's notice rather
   * than a click that did nothing.
   */
  const goToBlock = (id: string) =>
    act(async () => {
      const found = await graph.locate(id);
      if (!found) throw new Error('That block no longer exists.');
      setTrail((trail) => go(trail, { page: found.page }));
      setTarget({ id, version: 0 });
    });

  /**
   * Makes a block the root of the view: what its dot does. Looked up in main
   * like `goToBlock`, because a dot in a cut belongs to a page that is not
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
   * The ⋯ menu's delete, once confirmed. Off the page first, back past every
   * stop on it (`leave`), then the write: the view this window asks for next
   * is wherever it landed, never the page that is going.
   */
  const deletePage = (gone: string) =>
    act(async () => {
      const key = canonicalize(gone);
      deleting.current.add(key);
      setTrail((trail) => leave(trail, gone));
      setRecent((recent) => ({ ...recent, list: forget(recent.list, gone) }));
      try {
        await bridge.run({ type: 'deletePage', title: gone });
      } finally {
        // The notice of it reaches this window before the reply does.
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
      if (mark.matches('.block-ref')) goToBlock(ref);
      else zoomTo(ref);
      return;
    }
    const link = (event.target as Element).closest('a.wikilink[href]');
    const page = link?.getAttribute('href')?.slice(1);
    if (!page) return;
    event.preventDefault();
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

  /**
   * Whether the Cmd/Ctrl+K box is open. The key opens it from anywhere, a
   * block being written included, and closes it again. On the window, so it
   * is heard whatever has focus. Cmd/Ctrl+\\ toggles the sidebar the same way.
   */
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (opensFinder(event, mac)) {
        event.preventDefault();
        setFinding((open) => !open);
      } else if (togglesSidebar(event, mac)) {
        event.preventDefault();
        toggle.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mac]);

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
      // A drag-select going on has its own Escape, and nothing else moves it.
      if (!chosen || event.isComposing || dragged.current) return;
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
    return watchDrag({
      rows: () => readRows(root),
      press: (event) => {
        // Ctrl+click on macOS is a right-click.
        if (mac && event.ctrlKey) return undefined;
        const target = event.target;
        if (!(target instanceof Element)) return undefined;
        const around = !root.contains(target) && target.contains(root);
        if (!around && !root.contains(target)) return undefined;
        const row = target.closest<HTMLElement>('[data-slot]')?.dataset.slot;
        const own = target.closest(
          '[data-block-ref], a, img, button, input, select, [contenteditable="true"], [role="button"]:not([data-block-id])',
        );
        if (own) return undefined;
        if (target.closest('textarea') && row === undefined) return undefined;
        return { start: row, add: picks(event, mac) };
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

  /** What shows has changed: what is gone drops out of the selection. */
  useEffect(() => {
    setChosen((it) => it && followShown(it, onScreen().map((entry) => entry.key)));
  }, [held, browsing]);

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
    const chosen = latestChosen.current;
    if (!chosen) return;
    const blockIds = roots(onScreen(), chosen.keys).map((it) => it.id);
    setChosen(null);
    if (blockIds.length === 0) return;
    const zoomed = zoom ? held?.view.showing[0]?.page : undefined;
    if (zoom && zoomed && blockIds.includes(zoom)) {
      setTrail((trail) => rezoom(trail, locate(zoomed.blocks, zoom)?.parent?.id));
    }
    act(() => bridge.run({ type: 'deleteBlocks', blockIds }));
  };
  /** `removeChosen` as of this render, for the key listener set up once. */
  const removing = useRef(removeChosen);
  removing.current = removeChosen;

  /**
   * How many blocks a delete of the selection takes, when `slot` is one of
   * them: its dot's menu then deletes them all. Undefined for a slot that is
   * not selected, whose menu acts on its block alone.
   */
  const deletingOf = (slot: string): number | undefined => {
    const chosen = latestChosen.current;
    return chosen?.keys.includes(slot) ? roots(onScreen(), chosen.keys).length : undefined;
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
    <OwnEdit.Provider value={fields?.ownEdit ?? noEdit}>
      {/* Outside the view, so a click in it is not taken for one on a link,
          and a paste into it is text rather than an image for the page. */}
      {/* Outside the view too: its entries are buttons, not links in a page,
          so the view's capture of a click on a link stays out of it. */}
      {!collapsed && (
        <Sidebar
          recent={recent.list}
          showing={place?.page}
          browsing={browsing}
          onJournal={() => step(home)}
          onAllPages={() => step(browse)}
          onOpen={(page) => step((trail) => go(trail, { page }))}
        />
      )}
      {titlebarStart !== null &&
        createPortal(
          <Toggle collapsed={collapsed} mac={mac} onToggle={() => toggle.current()} />,
          titlebarStart,
        )}
      {finding && (
        <Finder
          find={graph.find}
          onOpen={(hit) => {
            setFinding(false);
            if ('block' in hit) goToBlock(hit.block);
            else step((trail) => go(trail, { page: hit.page }));
          }}
          onClose={() => setFinding(false)}
        />
      )}
      <div
        ref={wrapper}
        onClickCapture={follow}
        onContextMenu={blockMenu}
        // A drop is only offered where `dragover` was refused its default.
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={onDrop}
      >
        {/* The way back belongs with the window's own controls, beside the
            project picker, not on the page it is a way back from — it is about
            where you are, like the picker is, and the page below it is just
            what is there at the moment. `App` owns that strip, and this view
            owns the state the button acts on, so the button goes up there
            through a portal: still this view's, rendered in App's corner. */}
        {titlebar !== null &&
          trail.length > 0 &&
          createPortal(
            // Borderless until pointed at, like the picker beside it. Capped,
            // because it names the page it goes back to, and a page is named
            // whatever a link said — long enough to shove the picker out.
            <button
              className="app-region-no-drag ml-1 max-w-56 cursor-pointer truncate rounded-md border border-transparent px-1.5 py-0.5 text-sm hover:border-accent hover:text-accent"
              onClick={() => step(back)}
            >
              ← {label(trail.at(-2))}
            </button>,
            titlebar,
          )}

        {browsing && (
          // The journal is still asked for underneath, as on an empty trail:
          // it is what back from a list that started the trail lands on.
          <AllPages
            graph={graph}
            sort={sort}
            onSort={setSort}
            onOpen={(page) => step((trail) => go(trail, { page }))}
            onError={(error) => act(() => Promise.reject(error))}
          />
        )}

        {!browsing && own && (
          <PageMenu
            title={own.page.title}
            canDelete={own.page.blocks.length > 0 || own.properties.length > 0}
            impact={{
              links: own.references.reduce((sum, it) => sum + it.blocks.length, 0),
              refs: own.refsTo,
            }}
            graph={graph}
            onDelete={() => deletePage(own.page.title)}
            act={act}
          />
        )}

        <Selecting.Provider value={selecting}>
        <Previews value={previews}>
          {browsing ? null : held === null ? (
            <p className="mt-1 text-sm text-muted">Loading…</p>
          ) : (
            held.view.showing.map(({ page, references, properties, tags, taggedBy }) => (
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
                  taggedBy={zoom ? undefined : taggedBy}
                  properties={properties}
                  tags={tags}
                  zoom={zoom}
                  onZoom={(block) => step((trail) => rezoom(trail, block))}
                  // No title is the journal: each day heads one of many.
                  linked={title === null}
                  act={act}
                />
              </div>
            ))
          )}
        </Previews>
        </Selecting.Provider>
      </div>
    </OwnEdit.Provider>
  );
}

/** No watcher yet: a field's own edit is nothing to note. */
const noEdit = (): void => undefined;
