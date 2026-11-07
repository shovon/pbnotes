/**
 * Where a page opens (#309): here, in the right sidebar beside it (#287),
 * or in a new tab (#298), shown at once or left behind the one showing.
 * Said by the keys held as it is clicked or picked, as a browser has them:
 * the platform's own modifier (Cmd on macOS, Ctrl elsewhere) for a new tab
 * in the background, with Shift too for a new tab shown at once, Shift
 * alone for beside, and neither for here.
 *
 * Pure, and told the platform rather than reading it, so it runs under
 * `node --test`. A component that opens a page hands up the keys held, and
 * the view that knows the platform asks this where.
 */

export type Where = 'here' | 'beside' | 'tab' | 'background';

/** The keys held, as a click or a key press has them. */
export type Keys = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };

/** No keys held: the way a page opens when nothing says otherwise. */
export const PLAIN: Keys = { shiftKey: false, metaKey: false, ctrlKey: false };

/**
 * Where a page opens with `keys` held. With the modifier, Shift says to
 * show the new tab rather than leave it behind, so a new tab is never
 * second to the sidebar. On macOS, Ctrl is not the modifier: Ctrl+click
 * there is a right-click.
 */
export function whereFrom(keys: Keys, mac: boolean): Where {
  if (mac ? keys.metaKey : keys.ctrlKey) return keys.shiftKey ? 'tab' : 'background';
  if (keys.shiftKey) return 'beside';
  return 'here';
}

/**
 * Where a page opens when picking it is choosing where to go next, as in
 * the finder: a new tab is shown at once, never left behind.
 */
export function shown(where: Where): Where {
  return where === 'background' ? 'tab' : where;
}
