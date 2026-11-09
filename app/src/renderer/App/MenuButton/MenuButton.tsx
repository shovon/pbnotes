import { useEffect, useRef } from 'react';
import { step } from './alt/alt';

type Props = {
  /**
   * Opens the app's menu with its top-left corner at `at`, in window pixels,
   * and resolves once it has closed: `window.pbnotes.window.menu`.
   */
  openMenu: (at: { x: number; y: number }) => Promise<void>;
};

/**
 * The app's menu where there is no menu bar (#341): Windows and Linux, whose
 * menu bar would be a row of its own above the titlebar strip. Last in the
 * strip, just short of the window controls, so the tabs are the top of the
 * window there as on macOS, where this is not drawn at all.
 *
 * The menu is native and main draws it, from the same template as the
 * application menu, so every item does what it does from the menu bar and
 * shows the same shortcut. Alt pressed alone opens it too, as Alt reaches
 * the menu bar in any Windows app (`alt/`).
 */
export default function MenuButton({ openMenu }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  // While the menu is up, a second click or Alt opens nothing: main is still
  // drawing the first.
  const showing = useRef(false);

  const open = () => {
    if (showing.current) return;
    showing.current = true;
    const rect = button.current?.getBoundingClientRect();
    void openMenu({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 }).finally(() => {
      showing.current = false;
    });
  };
  // The listeners below are added once, and call whichever `open` is current.
  const latest = useRef(open);
  latest.current = open;

  useEffect(() => {
    let armed = false;
    const key = (type: 'keydown' | 'keyup') => (event: KeyboardEvent) => {
      const { key, ctrlKey, metaKey, shiftKey, repeat } = event;
      const next = step(armed, { type, key, ctrlKey, metaKey, shiftKey, repeat });
      armed = next.armed;
      if (next.open) latest.current();
    };
    const down = key('keydown');
    const up = key('keyup');
    const cancel = () => {
      armed = false;
    };
    // Capture, so a view that stops a key on its way does not leave Alt armed.
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('pointerdown', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('pointerdown', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  return (
    <button
      ref={button}
      type="button"
      // Borderless until pointed at, like the toggle and picker. Last in the
      // strip whatever the open project portals into it, and at its far end
      // when nothing else is there to push it.
      className="app-region-no-drag order-last mr-1 ml-auto flex shrink-0 cursor-pointer items-center rounded-md border border-transparent p-1 text-muted hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent focus-visible:outline-none"
      aria-label="Menu (Alt)"
      aria-haspopup="menu"
      title="Menu (Alt)"
      onClick={open}
    >
      {/* Three dots down: the usual picture for "more" beside a window's
          own buttons, as Chrome and Edge have it. */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <circle cx="8" cy="3.5" r="1.25" />
        <circle cx="8" cy="8" r="1.25" />
        <circle cx="8" cy="12.5" r="1.25" />
      </svg>
    </button>
  );
}
