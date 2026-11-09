import { useCallback, useRef } from 'react';

/**
 * A function that is the same from render to render, and always calls the
 * latest `fn` it was handed: for a callback handed to a memoized child,
 * which a new function each render would draw again for nothing. Only for
 * calling later (on an event, an answer, a step), never during a render,
 * where it may still be the last render's.
 */
export function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}
