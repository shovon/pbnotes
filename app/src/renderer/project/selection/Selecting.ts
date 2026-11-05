import { createContext } from 'react';

/** How a box hands over to a selection: Shift+Up, Shift+Down, Escape, or a second Cmd+A. */
export type FromBox = 'up' | 'down' | 'here' | 'all';

/**
 * What every page view needs of the selection (#253), from `ProjectView`,
 * which holds it. A context rather than props, because a cut under a page is
 * another page view, several components down.
 */
export type Selecting = {
  /** Whether this is macOS: Cmd selects there, Ctrl elsewhere. */
  mac: boolean;
  /** The slots selected (`shown.ts`). A block under one of them shows selected too. */
  selected: ReadonlySet<string>;
  /** A block whose box to open, caret at its end: Enter on a selection. */
  opening: { scope: string; id: string } | null;
  /** The box `opening` named is open. */
  onOpened: () => void;
  /** A box closed, having written what was typed, and the selection starts at its slot. */
  fromBox: (slot: string, how: FromBox) => void;
  /**
   * How many blocks deleting the selection takes, when `slot` is selected,
   * or undefined when it is not (#258).
   */
  deleting: (slot: string) => number | undefined;
  /** Deletes the selection's blocks, each with its subtree, as one step. */
  removeChosen: () => void;
};

/** Nothing selected and nothing to tell: a page drawn alone, as in a story. */
export const Selecting = createContext<Selecting>({
  mac: false,
  selected: new Set(),
  opening: null,
  onOpened: () => undefined,
  fromBox: () => undefined,
  deleting: () => undefined,
  removeChosen: () => undefined,
});
