import { useEffect, useRef, useState } from 'react';

/**
 * How long the floating sidebar stays after the pointer leaves the toggle or
 * the sidebar: long enough to cross from the icon down into the column, or
 * to slip past its edge and come back.
 */
const LINGER = 300;

/**
 * The sidebar shown floating while it is collapsed, for as long as the
 * pointer is on the toggle or on the sidebar. Only pointing at the toggle
 * starts it, and only while collapsed; a click on the toggle ends it, so
 * collapsing the sidebar with the pointer still on the icon does not bring
 * it straight back.
 */
export function usePeek(collapsed: boolean) {
  const [peeking, setPeeking] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => cancel, []);

  return {
    peeking: collapsed && peeking,
    /** The pointer is on the toggle. */
    start: () => {
      cancel();
      if (collapsed) setPeeking(true);
    },
    /** The pointer is on the floating sidebar. */
    stay: cancel,
    /** The pointer left the toggle or the floating sidebar. */
    leave: () => {
      cancel();
      timer.current = window.setTimeout(() => setPeeking(false), LINGER);
    },
    /** The toggle was clicked. */
    stop: () => {
      cancel();
      setPeeking(false);
    },
  };
}
