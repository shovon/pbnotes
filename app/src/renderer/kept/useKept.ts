import { useEffect, useRef, useState } from 'react';
import type { Kept } from '../project/ProjectView';

/**
 * A value kept for this project, as React state: `initial` until what was
 * kept has loaded, and when nothing was. Setting it keeps it. A set before
 * the load lands wins over what loads.
 */
export function useKept<T>(kept: Kept<T>, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState(initial);
  const touched = useRef(false);
  useEffect(() => {
    let live = true;
    void kept.load().then((loaded) => {
      if (live && loaded !== undefined && !touched.current) setValue(loaded);
    });
    return () => {
      live = false;
    };
  }, [kept]);
  const set = (next: T) => {
    touched.current = true;
    setValue(next);
    kept.save(next);
  };
  return [value, set];
}
