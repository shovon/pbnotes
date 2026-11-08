import { createContext } from 'react';

/**
 * What choosing a page's icon needs from the window (#323): the emoji used
 * lately, which `ProjectView` keeps on the bench for the project, a way to
 * add to them, and the randomness *Random* picks with. A context, since
 * every `PageView` a window draws (a tab's, a card's) shares one list.
 *
 * The default is inert, for a view drawn with no window around it: no
 * recent emoji, nothing kept, and *Random* always the first emoji.
 */
export type IconPicking = {
  recent: readonly string[];
  used: (emoji: string) => void;
  random: () => number;
};

export const IconPicking = createContext<IconPicking>({
  recent: [],
  used: () => undefined,
  random: () => 0,
});
