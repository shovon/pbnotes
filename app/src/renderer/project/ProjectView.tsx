import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GraphApi, Undone } from '../../shared/graph';
import type { Act } from '../ui';
import type { PageViewGraph } from './PageView/PageView';
import { back, browse, go, home, label, placeOf, ALL_PAGES } from './trail/trail';
import type { Stop } from './trail/trail';
import Finder from './Finder/Finder';
import { opensFinder } from './Finder/shortcut/shortcut';
import Sidebar from './Sidebar/Sidebar';
import Toggle from './Sidebar/Toggle/Toggle';
import { forget, renamedIn as renamedInRecent, visit } from './Sidebar/recent/recent';
import { togglesSidebar } from './Sidebar/shortcut/shortcut';
import { usePeek } from './Sidebar/peek';
import { createDispatcher } from './undo/dispatcher/dispatcher';
import { watchFields } from './undo/fields';
import { landing } from './undo/landing/landing';
import type { Fields } from './undo/fields';
import { OwnEdit } from './undo/own-edit';
import { shelve } from './Aside/stack/stack';
import Tab from './Tab/Tab';
import { NEW_TAB, held, left, renamedIn as renamedInTab, withField } from './Tab/state/state';
import type { TabState } from './Tab/state/state';

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
    | 'renamed'
    | 'find'
    | 'pages'
    | 'addImage'
    | 'image'
    | 'imageSource'
    | 'carryImages'
    | 'copy'
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

/**
 * A project in one window: the window's own controls, and the tab that
 * shows a place in it (`Tab/`).
 *
 * The window holds what is the same whatever the tab is on: the sidebar on
 * the left (whether it is collapsed, and Recent), the finder, undo, and the
 * way back in the titlebar. It also holds what the tab keeps (`TabState`:
 * where it is, how it got there, and what it has open beside it), so the
 * sidebar, the finder and undo can step it, and the tab draws it and steps
 * it too. A project change remounts this view (`App` keys it by project),
 * so the tab starts over at the journal without anyone being told.
 */
export default function ProjectView({ act, graph, now, mac, recentPages, sidebar }: Props) {
  /** The tab, as it keeps while it is not drawn: one, for now. */
  const [tab, setTab] = useState<TabState>(NEW_TAB);
  const { trail } = tab;
  /** Where the tab is: undefined on the journal and on the list of every page. */
  const place = placeOf(trail.at(-1));
  const browsing = trail.at(-1) === ALL_PAGES;
  /** The page the tab is on now, for what lands later than it moved. */
  const latestPage = useRef(place?.page);
  latestPage.current = place?.page;

  /** A step the user took: through `act`, like every other gesture. */
  const step = (take: (trail: Stop[]) => Stop[]) =>
    act(async () => setTab((tab) => withField(tab, 'trail', take(tab.trail))));
  /** Shift+click on a page, wherever it is: on top of the right sidebar. */
  const putAside = (page: string) =>
    act(async () => setTab((tab) => withField(tab, 'aside', shelve(tab.aside, page))));
  /** A click on a page, Shift held or not. */
  const open = (page: string, beside: boolean) =>
    beside ? putAside(page) : step((trail) => go(trail, { page }));

  /**
   * Opens the page a block is on, the way a wikilink does, and brings the
   * block into view. A block that is gone lands in the app's notice rather
   * than a click that did nothing.
   */
  const goToBlock = (id: string) =>
    act(async () => {
      const found = await graph.locate(id);
      if (!found) throw new Error('That block no longer exists.');
      setTab((tab) =>
        withField(withField(tab, 'trail', go(tab.trail, { page: found.page })), 'target', {
          id,
          version: 0,
        }),
      );
    });

  /**
   * The page `from` is now called `to` (#109): the tab and Recent read `to`
   * wherever they held `from`, so the window moves with the page.
   */
  const followRename = (from: string, to: string) => {
    setTab((tab) => renamedInTab(tab, from, to));
    setRecent((recent) => ({ ...recent, list: renamedInRecent(recent.list, from, to) }));
  };
  /**
   * A page renamed elsewhere (#301), in another window or on another
   * machine, while the window holds it but is not showing it: a card, a
   * stop further back, a Recent entry. The tab sees a rename only of the
   * page on show (`renamed/`), so the window asks main about every name it
   * holds, and follows each that a rename left behind. An alias someone
   * added is not a rename, and main leaves it out. A failure says nothing:
   * the tab's own fetch already says when the project cannot be reached.
   * Rebound each render, for what is held now.
   */
  const followRenames = useRef(() => undefined as void);
  followRenames.current = () => {
    const names = [...held(tab), ...recent.list];
    if (names.length === 0) return;
    void graph.renamed(names).then(
      (found) => {
        for (const { from, to } of found) followRename(from, to);
      },
      (): void => undefined,
    );
  };

  /** The page `gone` was deleted: the tab steps off it, and Recent forgets it. */
  const forgetPage = (gone: string) => {
    setTab((tab) => left(tab, gone));
    setRecent((recent) => ({ ...recent, list: forget(recent.list, gone) }));
  };

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
      const page = latestPage.current;
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

  // Once Recent has loaded, since it is kept: a page in it may have been
  // renamed while the app was closed. And on every change after that.
  useEffect(() => {
    if (recent.loaded) followRenames.current();
  }, [recent.loaded]);
  useEffect(() => {
    const off = graph.onChanged(() => followRenames.current());
    // A stubbed bridge — Storybook's — answers with something that is not an
    // unsubscribe, and a cleanup that is not a function throws.
    return () => {
      if (typeof off === 'function') off();
    };
  }, [graph]);

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
    // Shown or hidden for good now, so not floating, however it was asked for.
    peek.stop();
    const next = !collapsed;
    setCollapsed(next);
    sidebar.save({ collapsed: next });
  };
  /** Collapsed, the sidebar floats over the page while the toggle is pointed at. */
  const peek = usePeek(collapsed);

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
        setTab((tab) => {
          const moved = page === undefined ? tab : withField(tab, 'trail', go(tab.trail, { page }));
          return block === undefined ? moved : withField(moved, 'target', { id: block, version });
        });
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

  return (
    <OwnEdit.Provider value={fields?.ownEdit ?? noEdit}>
      {/* Outside the view, so a click in it is not taken for one on a link,
          and a paste into it is text rather than an image for the page. */}
      {/* Outside the view too: its entries are buttons, not links in a page,
          so the view's capture of a click on a link stays out of it. */}
      {(!collapsed || peek.peeking) && (
        <Sidebar
          recent={recent.list}
          showing={place?.page}
          browsing={browsing}
          onJournal={() => step(home)}
          onAllPages={() => step(browse)}
          onOpen={open}
          floating={collapsed}
          onPointerEnter={peek.stay}
          onPointerLeave={peek.leave}
        />
      )}
      {titlebarStart !== null &&
        createPortal(
          <Toggle
            collapsed={collapsed}
            mac={mac}
            onToggle={() => toggle.current()}
            onPointerEnter={peek.start}
            onPointerLeave={peek.leave}
          />,
          titlebarStart,
        )}
      {finding && (
        <Finder
          find={graph.find}
          onOpen={(hit, beside) => {
            setFinding(false);
            if ('block' in hit) goToBlock(hit.block);
            else open(hit.page, beside);
          }}
          onClose={() => setFinding(false)}
        />
      )}
      {/* The way back belongs with the window's own controls, beside the
          project picker, not on the page it is a way back from — it is about
          where you are, like the picker is. `App` owns that strip, and this
          view owns the trail the button steps, so the button goes up there
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
      <Tab
        act={act}
        graph={graph}
        now={now}
        mac={mac}
        tab={tab}
        update={setTab}
        onOpen={open}
        onBlock={goToBlock}
        onRenamed={followRename}
        onDeleted={forgetPage}
      />
    </OwnEdit.Provider>
  );
}

/** No watcher yet: a field's own edit is nothing to note. */
const noEdit = (): void => undefined;
