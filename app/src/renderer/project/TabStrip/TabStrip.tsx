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
 * Only the entries and the + take the pointer: the room around them stays
 * the title bar, which drags the window. Many tabs shrink, all alike, to a
 * width a short name still reads in, then scroll sideways, with the active
 * one kept in sight and the + outside what scrolls, so it is always there.
 */
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
    if (id === shown) return;
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

  // Taken past the last tab, the dragged tab pushes the + along its right.

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
            <div
              key={id}
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
                on ? 'bg-bg text-fg' : 'text-muted hover:bg-line hover:text-fg'
              } ${drag || float?.settling === 'cancel' ? 'transition-transform duration-150' : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={on}
                title={label}
                className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-0.5 pl-2.5 text-left"
                // On the press, as Chrome does, so a drag drags the tab showing.
                // Not a middle press, which closes, or one with a modifier.
                onMouseDown={(event) => {
                  const plain = !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
                  if (event.button === 0 && plain) press(id);
                }}
                onClick={() => onSelect(id)}
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
                className={`h-full cursor-pointer px-1.5 leading-none hover:text-accent ${
                  on ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`}
                onClick={(event) => closeFrom(event, id)}
              >
                ×
              </button>
            </div>
          );
        })}
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
                it.id === active ? 'bg-bg text-fg' : 'bg-line text-fg'
              }`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5 pr-0.5 pl-2.5">
                <PageIcon icon={it.icon} />
                <span className="truncate">{it.label}</span>
              </span>
              <span className="px-1.5 leading-none">×</span>
            </div>
          );
        })()}
      <button
        ref={plus}
        type="button"
        aria-label="New tab"
        title="New tab"
        className="app-region-no-drag shrink-0 cursor-pointer px-2.5 text-sm text-muted hover:bg-line hover:text-fg"
        onClick={onNew}
      >
        +
      </button>
    </div>
  );
}
