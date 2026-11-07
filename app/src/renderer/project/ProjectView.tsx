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
import { held, left, renamedIn as renamedInTab, withField } from './Tab/state/state';
import type { TabState } from './Tab/state/state';
import type { Held } from './held/held';
import { activated, activeOf, closed, each, next, opened, previous, single, updated } from './tabs/tabs';
import type { Tabs } from './tabs/tabs';
import TabStrip from './TabStrip/TabStrip';
import type { TabItem } from '../../shared/window';

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
  /** Closes this window: what closing its last tab does (#303). */
  closeWindow: () => Promise<void>;
  /** Hears the menu's tab items (#304). Returns an unsubscribe. */
  onTab: (listener: (item: TabItem) => void) => () => void;
  /** The pages opened lately in this project, newest first. */
  recentPages: Kept<string[]>;
  /** Whether this project's sidebar is collapsed. */
  sidebar: Kept<{ collapsed: boolean }>;
};

/**
 * A project in one window: the window's own controls, and its tabs (#298,
 * #303), each a place in the project (`Tab/`).
 *
 * The window holds what is the same whatever tab is showing: the sidebar
 * on the left (whether it is collapsed, and Recent), the finder, undo, the
 * way back and the tab strip in the titlebar. It also holds what every tab
 * keeps (`tabs/`, each a `TabState`: where it is, how it got there, and
 * what it has open beside it), so the sidebar, the finder and undo can
 * step the active one, and a rename or a delete reaches them all. Only the
 * active tab is drawn: one drawn and hidden would ask main again on every
 * change, and hear the keys meant for the one showing. A project change
 * remounts this view (`App` keys it by project), so every tab closes and
 * the project opens with one, on the journal, without anyone being told.
 */
export default function ProjectView({
  act,
  graph,
  now,
  mac,
  closeWindow,
  onTab,
  recentPages,
  sidebar,
}: Props) {
  /** Names a tab as it opens: only told apart, never read. */
  const count = useRef(1);
  const newId = () => `tab-${count.current++}`;
  /** Every tab, and which is drawn. */
  const [tabs, setTabs] = useState<Tabs>(() => single('tab-0'));
  const { id: activeId, tab } = activeOf(tabs);
  /** Steps the tab that is active when the step lands: what the window's own controls step. */
  const setTab = (step: (tab: TabState) => TabState) =>
    setTabs((all) => updated(all, all.active, step));
  const { trail } = tab;

  /**
   * What a tab leaves behind when another is drawn, by its id: the view it
   * drew last, so coming back draws it at once and still notices a page
   * deleted meanwhile (`deleted/` compares two answers), and how far the
   * window was scrolled, which is the window's and not the tab's. Not
   * state: nothing is drawn from it until the tab mounts again.
   */
  const behind = useRef(new Map<string, { held: Held | null; scroll: number }>());
  const remember = (id: string, held: Held) =>
    behind.current.set(id, { held, scroll: behind.current.get(id)?.scroll ?? 0 });
  /**
   * How far the window was scrolled on the tab being left, kept for when it
   * is back, and what is being typed in it written first. A box takes blur
   * as its commit, and one React takes away never blurs: switched away from
   * by a key, with nothing clicked to take the focus, its text would go.
   */
  const leave = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    leaveScroll();
  };
  const leaveScroll = () =>
    behind.current.set(activeId, { held: behind.current.get(activeId)?.held ?? null, scroll: window.scrollY });
  const showTab = (id: string) => {
    if (id === activeId) return;
    leave();
    setTabs((all) => activated(all, id));
  };
  const openTab = () => {
    leave();
    const id = newId();
    setTabs((all) => opened(all, id));
  };
  /** Closing the only tab closes the window, through main (`window:close`). */
  const closeTab = (id: string) => {
    if (id === activeId) leave();
    const next = closed(tabs, id);
    if (!next) {
      void closeWindow();
      return;
    }
    behind.current.delete(id);
    setTabs(next);
  };
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
   * The menu's tab items (#304), by click or key: New Tab, Close Tab on the
   * active one, and the tab to either side, wrapping round. Rebound each
   * render, for the tabs as they are now.
   */
  const tabItem = useRef<(item: TabItem) => void>(() => undefined);
  tabItem.current = (item) => {
    if (item === 'new') openTab();
    else if (item === 'close') closeTab(activeId);
    else {
      const to = (item === 'next' ? next : previous)(tabs).active;
      showTab(to);
    }
  };
  useEffect(() => {
    const off = onTab((item) => tabItem.current(item));
    // A stubbed bridge answers with something that is not an unsubscribe.
    return () => {
      if (typeof off === 'function') off();
    };
  }, [onTab]);

  /**
   * The page `from` is now called `to` (#109): the tab and Recent read `to`
   * wherever they held `from`, so the window moves with the page.
   */
  const followRename = (from: string, to: string) => {
    setTabs((all) => each(all, (tab) => renamedInTab(tab, from, to)));
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
    const names = [...tabs.list.flatMap((it) => held(it.tab)), ...recent.list];
    if (names.length === 0) return;
    void graph.renamed(names).then(
      (found) => {
        for (const { from, to } of found) followRename(from, to);
      },
      (): void => undefined,
    );
  };

  /** The page `gone` was deleted: every tab steps off it, and Recent forgets it. */
  const forgetPage = (gone: string) => {
    setTabs((all) => each(all, (tab) => left(tab, gone)));
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
      {/* The way back and the tabs belong with the window's own controls,
          beside the project picker, not on the page: they are about where
          you are, like the picker is. `App` owns that strip, and this view
          owns the tabs and the trail the button steps, so they go up there
          through a portal: still this view's, rendered in App's corner. One
          portal for both, so the two stay in that order. */}
      {titlebar !== null &&
        createPortal(
          // The full height of the bar and one pixel over its bottom rule, so
          // the tabs fill it and the active one, in the page's colour, covers
          // the rule as if the page came up into it. The rest leave it showing.
          <div className="flex h-[calc(100%+1px)] min-w-0 flex-1 items-center self-start">
            {/* Always there and always as wide, so switching tabs never moves
                the tabs beside it: off when there is nowhere to go back to,
                and the page it goes back to in its tooltip. */}
            <button
              type="button"
              disabled={trail.length === 0}
              aria-label={trail.length > 0 ? `Back to ${label(trail.at(-2))}` : 'Back'}
              title={trail.length > 0 ? `Back to ${label(trail.at(-2))}` : undefined}
              className="app-region-no-drag ml-1 shrink-0 cursor-pointer rounded-md border border-transparent px-1.5 py-0.5 text-sm enabled:hover:border-accent enabled:hover:text-accent disabled:cursor-default disabled:text-muted disabled:opacity-50"
              onClick={() => step(back)}
            >
              ←
            </button>
            <TabStrip
              tabs={tabs.list.map((it) => ({ id: it.id, label: label(it.tab.trail.at(-1)) }))}
              active={activeId}
              onSelect={showTab}
              onClose={closeTab}
              onNew={openTab}
            />
          </div>,
          titlebar,
        )}
      <Tab
        // A tab of its own each: nothing drawn in one (an open box, a
        // selection, main's answer) is handed to another.
        key={activeId}
        act={act}
        graph={graph}
        now={now}
        mac={mac}
        tab={tab}
        update={(step) => setTabs((all) => updated(all, activeId, step))}
        resume={behind.current.get(activeId) ?? null}
        onHeld={(held) => remember(activeId, held)}
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
