import { createContext } from 'react';

/**
 * The slot of the block being dragged by its dot (#251), or null when none
 * is: from `ProjectView`, which runs the drag, to every page view, which
 * draws that block and everything under it as moving. A context, as
 * `Selecting` is, because a cut under a page is another page view, several
 * components down.
 */
export const Dragging = createContext<string | null>(null);
