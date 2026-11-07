import { createContext } from 'react';

/**
 * The slots of the blocks being dragged by a dot (#251, #269), none when no
 * drag is on: from `Tab`, which runs the drag, to every page view,
 * which draws each of those blocks and everything under it as moving. A context, as
 * `Selecting` is, because a cut under a page is another page view, several
 * components down.
 */
export const Dragging = createContext<ReadonlySet<string>>(new Set());
