/**
 * The window's tabs, in the title bar after the way back (#303): one entry
 * per tab, named for what it shows, the active one marked. A click on an
 * entry shows that tab, its × closes it, and + opens a new one on the
 * journal. It shows with one tab too, so there is always somewhere to see
 * that tabs are there.
 *
 * Tabs, not buttons: each fills the title bar's height, edge to edge with
 * the next, the active one in the page's own colour, as if the page came
 * up into it, the rest the bar's own colour (`bar`, a shade off the page).
 * The colours are placeholders until the strip is designed.
 *
 * Every tab is one width, whatever it is called (#311), so the strip is
 * even and a tab's × stays put when its page is renamed. A name that does
 * not fit is cut short; its tooltip has it whole.
 *
 * Closing a tab while the pointer is on the strip keeps every tab the width
 * it was, as a browser does: the next tab's × comes under the pointer, so a
 * row of them closes with clicks in one place. Once the pointer leaves the
 * strip, they take the width that now fits. The strip sits in the title
 * bar, whose drag region the window hears nothing over, so leaving it is
 * heard once the pointer reaches somewhere that is not drag region.
 *
 * A tab dragged sideways moves along the strip (#338): it follows the
 * pointer, the tabs it passes slide aside by its width (`slide/`), and it
 * lands where it is let go, springing into its place. It can be taken as
 * far past either end of the strip as the pointer goes, where there is
 * nothing, and springs back to the end it went past: the last place, or
 * the first. Taken past the last tab, it pushes the + along with it, so the
 * + is always to the right of the last tab, as it will be once it lands.
 * Escape puts it back. The strip scrolls when it is held near either end.
 *
 * Pressing a tab shows it at once, as Chrome does, not on letting go: a
 * tab dragged is always the one showing, in the page's colour, standing
 * out of the rest. The strip marks it at once; drawing its page is left to
 * React as work it may put aside (`startTransition`), since a long page
 * takes a while to draw, and a drag begun meanwhile would wait on it. The click a drag ends with is swallowed (`gesture/`),
 * so it closes nothing. A press on a × closes, never drags, and never
 * shows the tab.
 *
 * A tab's width eases from what it was to what it is, whenever the tabs
 * share the room anew: one opening (from nothing), one closing, the widths
 * a close kept letting go. An ease, not the spring a drag settles with:
 * room shared out, not a thing let go of.
 *
 * A tab closed tucks itself away behind the one after it: it stays drawn
 * a moment where it was, narrowing from its right edge with its name held
 * still, as the tab after it (or the +) slides over the room it leaves.
 *
 * A tab that opens behind the one showing (#309) lights up a moment and
 * fades, so a Cmd/Ctrl+click that left the page as it was still says it
 * did something. One that opens shown needs no telling.
 *
 * The cursor stays the arrow over all of it, as over a browser's tabs:
 * they are the window's own controls, not links in a page.
 *
 * Only the entries and the + take the pointer: the room around them stays
 * the title bar, which drags the window. Many tabs shrink, all alike, to a
 * width a short name still reads in, then scroll sideways, with the active
 * one kept in sight and the + outside what scrolls, so it is always there.
 */
import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import PageIcon from '../PageIcon/PageIcon';
import { watchGesture } from '../gesture/gesture';
import { shiftOf, slideTo } from './slide/slide';
import type { Box } from './slide/slide';

/** How far a press on a tab moves sideways before it is a drag, not a click. */
const THRESHOLD = 4;

/** A press on a tab, as it went down: what a drag from it moves, and the strip as it was. */
type Press = {
  id: string;
  /** Its index in the strip. */
  from: number;
  /** Where it went down, in client coordinates. */
  x: number;
  /** How far the strip was scrolled then. */
  scroll: number;
  /** Every tab's room along the strip's content, then. */
  boxes: Box[];
};

/** A tab closed, drawn a moment where it was while it tucks away. */
type Leaving = StripTab & { at: number; width: number };

/** A drag on: the tab dragged, and where it would land. */
type Drag = { id: string; from: number; to: number; width: number };

/**
 * The dragged tab as it is drawn: a copy floating over the strip, outside
 * what scrolls, so pulled past either end it is neither clipped nor scrolls
 * the strip after it. Let go, it
 * settles into the tab's place, after a drop or back where it was after
 * Escape, and then the tab itself shows again.
 *
 * Where it is drawn (`floatLeft`, from the strip's own left edge) is not
 * React state: a move sets it on the copy, and on the + it pushes, itself.
 * React gives an update from a move, applied in an animation frame, a
 * priority that waits behind a tab's page being drawn in a transition, and
 * the copy would stand still until a long journal was drawn (#338).
 *
 * So those two properties have one owner each, and it is not React: the
 * copy's `left` and the +'s `transform` are never in the markup, so no
 * render can put back a value a move has passed, and none is left behind
 * for React to keep. The copy takes its place as it mounts (`placeCopy`, a
 * callback ref), so a copy drawn again starts where the drag is.
 */
type Float = { id: string; width: number; settling?: 'drop' | 'cancel' };

/** A spring, not a slide: past where it goes, and back. */
const SPRING = { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' };

/** A width shared out anew: an ease, with nothing past where it goes. */
const RESIZE = { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

export type StripTab = {
  id: string;
  /** What the tab shows: a page's name, "Journal" or "All pages". */
  label: string;
  /** The page's icon, drawn before its name when it can be (#323). */
  icon?: string;
};

type Props = {
  tabs: readonly StripTab[];
  /** The id of the tab drawn. */
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** The tab `id` was dragged to `index` in the order the strip shows (#338). */
  onMove: (id: string, index: number) => void;
};

/**
 * The ×, drawn rather than typed: a glyph sits on the font's baseline, never
 * quite in the middle of the circle a pointed-at × is drawn in.
 */
function Cross() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className="block">
      <path d="M1 1 7 7M7 1 1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function TabStrip({ tabs, active: shown, onSelect, onClose, onNew, onMove }: Props) {
  const list = useRef<HTMLDivElement>(null);
  /**
   * A tab pressed, marked active in the strip before its page is drawn: the
   * strip is drawn from it until the tab shown is the one pressed.
   */
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => setPressed(null), [shown]);
  const active = pressed ?? shown;
  /** Shows `id` on a press: marked here at once, its page drawn when React gets to it. */
  const press = (id: string) => {
    // Shown, or on its way: a click on the tab pressed a moment ago asks for
    // it again, and asking outside a transition would draw its page at once.
    if (id === shown || id === pressed) return;
    setPressed(id);
    startTransition(() => onSelect(id));
  };
  /** The drag going on, if one is. */
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = useRef(false);
  /** Whether the pointer is on the strip, for the widths kept after a close. */
  const over = useRef(false);
  /** `onMove` as of this render, for the drag set up once. */
  const moving = useRef(onMove);
  moving.current = onMove;
  /** The strip, which the floating copy is placed against. */
  const outer = useRef<HTMLDivElement>(null);
  /** The dragged tab as drawn, while a drag is on or settling. */
  const [float, setFloat] = useState<Float | null>(null);
  const floating = useRef<HTMLDivElement>(null);
  /** Where the copy is drawn, from the strip's own left edge (see `Float`). */
  const floatLeft = useRef(0);
  /** The copy, set where the drag has it as it mounts, and let go of as it goes. */
  const placeCopy = useCallback((copy: HTMLDivElement | null) => {
    floating.current = copy;
    if (copy) copy.style.left = `${floatLeft.current}px`;
    return () => {
      floating.current = null;
    };
  }, []);
  /** The +, and where it sits from the strip's left edge when nothing pushes it. */
  const plus = useRef<HTMLButtonElement>(null);
  const plusAt = useRef(0);
  /** How far the + is pushed now, for it to spring back from on letting go. */
  const pushed = useRef(0);
  // Let go: the copy springs from where it was drawn to where the tab now
  // is, the order already changed under it, and then gives way to the tab.
  useLayoutEffect(() => {
    if (!float?.settling) return;
    const done = () => setFloat((it) => (it === float ? null : it));
    // The + is pushed directly while dragging, not through React, so it is
    // put back here, however the copy settles.
    const push = pushed.current;
    pushed.current = 0;
    if (plus.current) plus.current.style.transform = '';
    const copy = floating.current;
    const tab = list.current?.querySelector(`[data-tab-id="${CSS.escape(float.id)}"]`);
    const box = outer.current?.getBoundingClientRect();
    if (!copy || !tab || !box || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return done();
    }
    const by = tab.getBoundingClientRect().left - box.left - floatLeft.current;
    const spring = copy.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${by}px)` }],
      { ...SPRING, fill: 'forwards' },
    );
    spring.onfinish = done;
    spring.oncancel = done;
    // The + it pushed goes back beside it, to where it sits: with it after a
    // drop, riding the copy into the last place; after Escape the last tab
    // is the real one, and a + springing past its home would lie over it.
    if (push > 0) {
      plus.current?.animate(
        [{ transform: `translateX(${push}px)` }, { transform: 'translateX(0)' }],
        float.settling === 'drop' ? SPRING : { duration: SPRING.duration, easing: 'ease-out' },
      );
    }
  }, [float]);
  /** The width every tab keeps after a close, until the pointer leaves the strip. */
  const [kept, setKept] = useState<number | null>(null);
  /** Closes `id` from a pointer on its tab, keeping that tab's width for the rest. */
  const closeFrom = (event: MouseEvent<HTMLElement>, id: string) => {
    const tab = event.currentTarget.closest('[data-tab]');
    if (tab) setKept(tab.getBoundingClientRect().width);
    onClose(id);
  };
  // The active tab in sight, however it became active: opened past the
  // end of what shows, or reached by a click on a tab half out of view.
  // The whole of it, its × and border too, not only the label it is named by.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.closest('[data-tab]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  // Dragging a tab along (#338). Its boxes are read when it goes down, along
  // the strip's content, so the strip scrolling under the drag counts too.
  useEffect(() => {
    const strip = list.current;
    if (!strip) return;
    /** Where the drag would land now, for when it is let go. */
    let to = -1;
    /** Where it was drawn as landing, last the strip was told. */
    let told = -1;
    /** How far the tabs' scroller starts in from the strip's left edge, for the copy. */
    const inset = () =>
      strip.getBoundingClientRect().left - (outer.current?.getBoundingClientRect().left ?? 0);
    const settle = (how: 'drop' | 'cancel') =>
      setFloat((it) => (it && !it.settling ? { ...it, settling: how } : it));
    return watchGesture<Press>({
      press: (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return undefined;
        const target = event.target instanceof Element ? event.target : null;
        const tab = target?.closest<HTMLElement>('[data-tab]');
        if (!tab || !strip.contains(tab) || target?.closest('[data-close]')) return undefined;
        // Widths still easing are where they are going first: a tab pressed
        // as it grows is dragged, and drawn, at the width it is growing to.
        for (const ease of [...easing.current.values()]) ease.finish();
        for (const tuck of [...tucking.current.values()]) tuck.finish();
        const all = [...strip.querySelectorAll<HTMLElement>('[data-tab]')];
        const start = strip.getBoundingClientRect().left;
        const boxes = all.map((it) => {
          const { left, width } = it.getBoundingClientRect();
          return { left: left - start + strip.scrollLeft, width };
        });
        const id = tab.dataset.tabId;
        if (id === undefined) return undefined;
        return { id, from: all.indexOf(tab), x: event.clientX, scroll: strip.scrollLeft, boxes };
      },
      begins: (_, from, at) => Math.abs(at.x - from.x) >= THRESHOLD,
      start: ({ id, from, boxes }) => {
        dragging.current = true;
        to = from;
        const { left, width } = boxes[from];
        // A spring still settling the last one is done with: this copy starts still.
        for (const spring of floating.current?.getAnimations() ?? []) spring.cancel();
        for (const spring of plus.current?.getAnimations() ?? []) spring.cancel();
        plusAt.current =
          (plus.current?.getBoundingClientRect().left ?? 0) -
          (outer.current?.getBoundingClientRect().left ?? 0);
        setDrag({ id, from, to, width });
        floatLeft.current = inset() + left - strip.scrollLeft;
        told = from;
        setFloat({ id, width });
      },
      move: ({ id, from, x, scroll, boxes }, at) => {
        // Along the strip only. Where it lands is held to the strip's two
        // ends; where it is drawn is wherever the pointer took it, past them
        // too, and it springs back to the end on letting go.
        const first = boxes[0].left;
        const last = boxes[boxes.length - 1];
        const own = boxes[from];
        const min = first - own.left;
        const max = last.left + last.width - (own.left + own.width);
        const pulled = at.x - x + strip.scrollLeft - scroll;
        to = slideTo(boxes, from, Math.max(min, Math.min(max, pulled)));
        // Drawn here, not through React (see `Float`): the copy, and the +
        // it pushes once it is going last.
        const left = inset() + own.left + pulled - strip.scrollLeft;
        floatLeft.current = left;
        if (floating.current) floating.current.style.left = `${left}px`;
        const push = to === boxes.length - 1 ? Math.max(0, left + own.width - plusAt.current) : 0;
        pushed.current = push;
        if (plus.current) plus.current.style.transform = push === 0 ? '' : `translateX(${push}px)`;
        // The tabs it passes slide aside through React, so only when where it
        // lands changes, and at once, ahead of a page being drawn.
        if (to !== told) {
          told = to;
          flushSync(() => setDrag({ id, from, to, width: own.width }));
        }
      },
      cancel: () => {
        dragging.current = false;
        settle('cancel');
        setDrag(null);
      },
      end: ({ id, from }, dropped) => {
        dragging.current = false;
        settle(dropped ? 'drop' : 'cancel');
        setDrag(null);
        if (dropped && to !== -1 && to !== from) moving.current(id, to);
        // Left the strip during the drag: the widths a close kept go now.
        if (!over.current) setKept(null);
      },
      scroller: () => strip,
      axis: 'x',
    });
  }, []);

  // Every tab's width as the layout gives it, to ease from when it changes.
  // Read after each render, before paint: what the layout gives each tab is
  // only known once it has given it. A tab not drawn before eases in from
  // none. An ease still going is taken off to read the width it is going
  // to, and put back from where it had got to: over the time it had left
  // when that is unchanged, over a whole ease when it is not. Not during a
  // drag, whose widths do not change, nor on first drawing the strip.
  const widths = useRef<ReadonlyMap<string, number> | null>(null);
  const easing = useRef(new Map<string, Animation>());
  /**
   * How many tabs are tucking away now, set as the strip is drawn, and as of
   * the last time widths were read. While one tucks, the room it gives up
   * goes to the rest as it narrows: they widen with it, and are where they
   * are going when it goes. Easing them then, from before it narrowed, would
   * take them back first.
   */
  const ghosts = useRef(0);
  const ghostsRead = useRef(0);
  useLayoutEffect(() => {
    const strip = list.current;
    if (!strip) return;
    const elements = new Map<string, HTMLElement>();
    for (const tab of strip.querySelectorAll<HTMLElement>('[data-tab-id]')) {
      if (tab.dataset.tabId !== undefined) elements.set(tab.dataset.tabId, tab);
    }
    // Where each ease has got to, then the widths with none applied.
    const midway = new Map<string, { width: number; left: number }>();
    for (const [id, ease] of easing.current) {
      const tab = elements.get(id);
      const elapsed = Number(ease.currentTime ?? 0);
      if (tab && ease.playState === 'running') {
        midway.set(id, {
          width: tab.getBoundingClientRect().width,
          left: RESIZE.duration - elapsed,
        });
      }
      ease.cancel();
    }
    easing.current.clear();
    const now = new Map<string, number>();
    for (const [id, tab] of elements) now.set(id, tab.getBoundingClientRect().width);
    const was = widths.current;
    widths.current = now;
    const tucking = ghosts.current > 0 || ghostsRead.current > ghosts.current;
    ghostsRead.current = ghosts.current;
    if (!was || drag || tucking || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    for (const [id, width] of now) {
      const going = midway.get(id);
      const from = going?.width ?? was.get(id) ?? 0;
      if (Math.abs(from - width) < 0.5) continue;
      const same = going !== undefined && Math.abs((was.get(id) ?? -1) - width) < 0.5;
      const ease = elements.get(id)?.animate(
        [
          { width: `${from}px`, minWidth: '0px', flexShrink: 0 },
          { width: `${width}px`, minWidth: '0px', flexShrink: 0 },
        ],
        { ...RESIZE, duration: same ? Math.max(16, going.left) : RESIZE.duration },
      );
      if (!ease) continue;
      easing.current.set(id, ease);
      ease.onfinish = () => easing.current.delete(id);
    }
  });

  // A tab opened behind the one showing lights up and fades. Told from the
  // tabs already drawn, so none does on first drawing the strip; read before
  // paint, so it never shows unlit first.
  const seen = useRef<ReadonlySet<string> | null>(null);
  useLayoutEffect(() => {
    const was = seen.current;
    seen.current = new Set(tabs.map((it) => it.id));
    if (!was) return;
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent')
      .trim();
    for (const { id } of tabs) {
      if (was.has(id) || id === shown) continue;
      list.current
        ?.querySelector(`[data-tab-id="${CSS.escape(id)}"]`)
        ?.animate(
          [
            { backgroundColor: `color-mix(in srgb, ${accent} 30%, transparent)` },
            { backgroundColor: 'transparent' },
          ],
          { duration: 1200, easing: 'ease-out' },
        );
    }
  }, [tabs]);

  /**
   * Tabs closed a moment ago, still drawn where they were while they tuck
   * away. Found in the very render a tab goes missing from `tabs`, so there
   * is no frame without it: `at` is where it was, which is now the place of
   * the tab that slides over it. Not tabs: nothing presses or measures one.
   */
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  ghosts.current = leaving.length;
  // By the ids, not the list: the window hands a new list every render.
  const ids = tabs.map((tab) => tab.id).join('\n');
  const [last, setLast] = useState({ ids, tabs });
  if (last.ids !== ids) {
    setLast({ ids, tabs });
    const gone = last.tabs
      .map((tab, at) => ({ ...tab, at, width: widths.current?.get(tab.id) ?? 0 }))
      .filter((it) => it.width > 0 && !tabs.some((tab) => tab.id === it.id));
    const still = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (gone.length > 0 && still) setLeaving((was) => [...was, ...gone]);
  }
  /** Each tucking away, by id, for a press to finish at once. */
  const tucking = useRef(new Map<string, Animation>());
  useLayoutEffect(() => {
    for (const it of leaving) {
      if (tucking.current.has(it.id)) continue;
      const ghost = list.current?.querySelector(`[data-leaving="${CSS.escape(it.id)}"]`);
      if (!ghost) continue;
      const tuck = ghost.animate([{ width: `${it.width}px` }, { width: '0px' }], {
        ...RESIZE,
        fill: 'forwards',
      });
      tucking.current.set(it.id, tuck);
      const done = () => {
        tucking.current.delete(it.id);
        setLeaving((was) => was.filter((other) => other !== it));
      };
      tuck.onfinish = done;
      tuck.oncancel = done;
    }
  }, [leaving]);
  /** The tabs tucking away that were at `at`, drawn there. */
  const tucked = (at: number) =>
    leaving
      .filter((it) => it.at === at)
      .map((it) => (
        <div
          key={`leaving:${it.id}`}
          data-leaving={it.id}
          aria-hidden
          style={{ width: it.width }}
          className="app-region-no-drag pointer-events-none flex shrink-0 overflow-hidden text-sm text-muted"
        >
          {/* Its full width inside, so its name stays still as it narrows. */}
          <div
            style={{ width: it.width }}
            className="flex shrink-0 items-center border-r border-line"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 pr-0.5 pl-2.5">
              <PageIcon icon={it.icon} />
              <span className="truncate">{it.label}</span>
            </span>
          </div>
        </div>
      ));

  /**
   * A drag on, or settling: nothing in the strip lights up under the
   * pointer, which passes over tabs and the + as it carries one along, and
   * a tab that is only being passed over is not being pointed at.
   */
  const quiet = drag !== null || float !== null;

  return (
    <div
      ref={outer}
      className="relative flex h-full min-w-0 items-stretch"
      onPointerEnter={() => {
        over.current = true;
      }}
      onPointerLeave={() => {
        over.current = false;
        // Not under a drag: the tabs would change width under it.
        if (!dragging.current) setKept(null);
      }}
    >
      <div
        ref={list}
        role="tablist"
        aria-label="Tabs"
        className="flex h-full min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map(({ id, label, icon }, at) => {
          const on = id === active;
          const shift = drag && id !== drag.id ? shiftOf(at, drag.from, drag.to, drag.width) : 0;
          // Drawn floating instead, while dragged or settling: its place stays.
          const hidden = float?.id === id;
          return (
            <Fragment key={id}>
              {tucked(at)}
              <div
                data-tab
                data-tab-id={id}
                // One width each, from the same basis, so they shrink alike.
                // Kept as it was after a close: not shrinking or growing until
                // the pointer leaves.
                // While a tab is dragged, the ones it passes slide aside. A drop
                // changes the order and drops them back to where it puts them,
                // which is where they already show, with no slide; after Escape
                // they slide back, as the copy springs home.
                style={{
                  ...(kept === null ? {} : { width: kept, minWidth: kept, flexShrink: 0 }),
                  ...(shift === 0 ? {} : { transform: `translateX(${shift}px)` }),
                  ...(hidden ? { visibility: 'hidden' as const } : {}),
                }}
                className={`app-region-no-drag group relative flex w-44 min-w-24 shrink items-center border-r border-line text-sm ${
                  // The active tab is ruled off on both sides, as a tab is. Its
                  // left rule is drawn over the tab before it's right one, so
                  // the two are one line and nothing moves; the first tab's
                  // lies just inside it, where the strip does not clip it.
                  on
                    ? `bg-bg text-fg before:absolute before:inset-y-0 before:w-px before:bg-line before:content-[''] ${at === 0 ? 'before:left-0' : 'before:-left-px'}`
                    : quiet
                      ? 'text-muted'
                      : 'text-muted hover:bg-line hover:text-fg'
                } ${drag || float?.settling === 'cancel' ? 'transition-transform duration-150' : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  title={label}
                  className="flex h-full min-w-0 flex-1 cursor-default items-center gap-1.5 pr-0.5 pl-2.5 text-left"
                  // On the press, as Chrome does, so a drag drags the tab showing.
                  // Not a middle press, which closes, or one with a modifier.
                  onMouseDown={(event) => {
                    const plain = !(
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    );
                    if (event.button === 0 && plain) press(id);
                  }}
                  // A click selects the same way, so one already on its way from
                  // the press is not asked for again (a Cmd or Shift click,
                  // which the press passed by, still selects here).
                  onClick={() => press(id)}
                  // A middle click closes, as in a browser.
                  onAuxClick={(event) => {
                    if (event.button === 1) closeFrom(event, id);
                  }}
                >
                  <PageIcon icon={icon} />
                  <span className="truncate">{label}</span>
                </button>
                <button
                  type="button"
                  data-close
                  aria-label={`Close ${label}`}
                  title="Close tab"
                  className={`group/close flex h-full cursor-default items-center px-1 leading-none ${
                    on
                      ? ''
                      : `opacity-0 focus-visible:opacity-100 ${quiet ? '' : 'group-hover:opacity-100'}`
                  }`}
                  onClick={(event) => closeFrom(event, id)}
                >
                  {/* Pointed at, the × sits in a circle of its own, as a browser
                    draws it: the whole button is the target, not only the
                    circle. Shaded from the text's own colour, so it reads on
                    the active tab and on a hovered one, in either theme. */}
                  <span
                    aria-hidden
                    className={`flex size-4 items-center justify-center rounded-full ${
                      quiet ? '' : 'group-hover/close:bg-fg/15 group-hover/close:text-fg'
                    }`}
                  >
                    <Cross />
                  </span>
                </button>
              </div>
            </Fragment>
          );
        })}
        {/* Closed from the end: the + slides over it. */}
        {[...new Set(leaving.filter((it) => it.at >= tabs.length).map((it) => it.at))].map(tucked)}
      </div>
      {float &&
        (() => {
          const it = tabs.find((tab) => tab.id === float.id);
          if (!it) return null;
          // The tab as it looks pointed at, above the rest. Out of the
          // drag region and taking no pointer: it lies over the strip and
          // the bar beside it only while the drag lasts.
          return (
            <div
              ref={placeCopy}
              aria-hidden
              style={{ width: float.width }}
              className={`app-region-no-drag pointer-events-none absolute inset-y-0 z-20 flex items-center border-r border-line text-sm ${
                it.id === active ? 'border-l bg-bg text-fg' : 'bg-line text-fg'
              }`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5 pr-0.5 pl-2.5">
                <PageIcon icon={it.icon} />
                <span className="truncate">{it.label}</span>
              </span>
              <span className="flex px-1 leading-none">
                <span className="flex size-4 items-center justify-center">
                  <Cross />
                </span>
              </span>
            </div>
          );
        })()}
      <button
        ref={plus}
        type="button"
        aria-label="New tab"
        title="New tab"
        className={`app-region-no-drag shrink-0 cursor-default px-2.5 text-sm text-muted ${quiet ? '' : 'hover:bg-line hover:text-fg'}`}
        onClick={onNew}
      >
        +
      </button>
    </div>
  );
}
