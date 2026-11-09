/**
 * Whether a press of Alt opens the app's menu (#341), as Alt reaches the
 * menu bar in any Windows app: Alt pressed and let go with nothing else in
 * between. Anything else that happens while it is down makes it part of
 * something else, and the menu stays shut:
 *
 * - another key, which is a shortcut (Alt+F4, Alt+←) or a character;
 * - Ctrl, Meta or Shift with it. Ctrl+Alt is AltGr on most keyboards outside
 *   the US (Windows reports AltGr as Ctrl+Alt), typing `@`, `€` or `é`, and
 *   Shift+Alt switches the keyboard's language;
 * - a click or the window losing focus (Alt+click, Alt+Tab), as `cancel`.
 *
 * Pure: the window's events in, whether to open out, so it runs under
 * `node --test`.
 */

/** What of a key event this needs, named as `KeyboardEvent` names it. */
export type Key = {
  type: 'keydown' | 'keyup';
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
};

/** A key event, or anything else that ends a lone Alt: a click, or the window losing focus. */
export type Input = Key | { type: 'cancel' };

/** `armed` while Alt is down alone; `open` when this input lets go of it. */
export type Step = { armed: boolean; open: boolean };

export function step(armed: boolean, input: Input): Step {
  if (input.type === 'cancel' || input.key !== 'Alt') return { armed: false, open: false };
  if (input.type === 'keyup') return { armed: false, open: armed };
  if (input.ctrlKey || input.metaKey || input.shiftKey) return { armed: false, open: false };
  // Held down, Alt repeats. A repeat changes nothing: Alt that went down
  // with something else is still part of it.
  return { armed: input.repeat ? armed : true, open: false };
}
