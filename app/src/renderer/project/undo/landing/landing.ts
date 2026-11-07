/**
 * What the window does with main's answer to an undo or a redo (#248): where
 * it goes, which block it highlights, and what it says. Pure; `ProjectView`
 * does it with the trail, the highlight and the app's notice.
 */
import type { Undone } from '../../../../shared/graph';

/** What the window does: each part optional, and nothing at all for `nothing`. */
export type Landing = {
  /** The page to go to, the way following a link does. */
  page?: string;
  /** The block to scroll to and flash, once the view holds `version`. */
  block?: string;
  /** The view this has to wait for: the fold's version after the undo. */
  version: number;
  /** A sentence for the app's notice: why undo stopped. */
  say?: string;
};

/** Why undo stopped, in a sentence, by the reason main gave. */
export const STOPPED = {
  changed: 'Someone else changed this since, so undo stopped here.',
  cannot: "This can't be undone, so undo stopped here.",
} as const;

/**
 * Where an undo or redo leaves the window. A step taken back, or one that
 * stopped undo, takes the window to where it happened, so the change, or the
 * conflict, is in view. Going there when undo stops is on trial (#248). With
 * nothing to do, nothing happens: that is not an error.
 */
export function landing(undone: Undone): Landing {
  const { version, result, page, block } = undone;
  if (result === 'nothing' || page === undefined) return { version };
  return {
    version,
    page,
    ...(block === undefined ? {} : { block }),
    ...(result === 'done' ? {} : { say: STOPPED[result] }),
  };
}
