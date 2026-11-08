import { lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import Icon from '../../../Icon/Icon';
import { drawable } from '../../PageIcon/drawable/drawable';
import { IconPicking } from '../../IconPicking/IconPicking';

/**
 * The picker, loaded the first time one opens: its emoji data is most of a
 * megabyte, and most windows never open it.
 */
const EmojiPicker = lazy(() => import('../../../EmojiPicker/EmojiPicker'));

type Props = {
  /** The page's icon as drawn (main's, with writes in flight folded over it). */
  icon: string | undefined;
  /** An emoji was picked for the page. */
  onSet: (emoji: string) => void;
  /** *Remove* in the picker. */
  onRemove: () => void;
};

/**
 * A page's icon in its header (#323): large above the title, and a click on
 * it opens the picker to change or remove it. A page with none, or with one
 * this build can't draw, has "Add icon" in the line above the title instead,
 * beside "Add tag" and "Add property", and marked `data-bare` and
 * `data-reveal` as they are, so `PageView` hides and shows it with them.
 *
 * Only the page's own view draws one: not a journal day, a zoom, or a cut.
 * Where the picker sits, and that a click outside closes it, is this one's;
 * what the picker shows is `EmojiPicker`'s (#325).
 */
export default function HeaderIcon({ icon, onSet, onRemove }: Props) {
  const { recent, used, random } = useContext(IconPicking);
  const root = useRef<HTMLDivElement>(null);
  /** The button that opens the picker: the icon, or "Add icon". */
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const shown = drawable(icon);

  /**
   * Closes the picker. After Escape, a pick or *Remove*, focus goes to the
   * button that opens it again, which after a pick or *Remove* is the other
   * one, drawn on the next frame. A press elsewhere keeps the focus it gave.
   */
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => trigger.current?.focus());
  };

  /* A press anywhere outside closes it, as a menu does. */
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  return (
    <div
      ref={root}
      data-icon
      data-bare={shown ? undefined : ''}
      // With an icon it takes a line of its own above the title: `PageView`
      // puts what is not bare under the title, and this is the exception.
      style={shown ? { order: -2 } : undefined}
      className={`relative ${shown ? 'mt-6 -mb-3' : ''}`}
    >
      {shown ? (
        <button
          ref={trigger}
          type="button"
          aria-label="Change icon"
          aria-expanded={open}
          title="Change icon"
          className="-ml-1 cursor-pointer rounded-md p-1 text-5xl leading-none hover:bg-line focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => setOpen((it) => !it)}
        >
          {shown}
        </button>
      ) : (
        <button
          ref={trigger}
          type="button"
          data-reveal
          aria-expanded={open}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 text-sm text-muted hover:text-fg focus-visible:text-fg"
          onClick={() => setOpen((it) => !it)}
        >
          <Icon of={SmilePlus} />
          Add icon
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1">
          <Suspense fallback={null}>
            <EmojiPicker
              // The value as written, so *Remove* is there for one this
              // build can't draw too.
              value={icon}
              recent={recent}
              random={random}
              onPick={(emoji) => {
                close(true);
                used(emoji);
                if (emoji !== icon) onSet(emoji);
              }}
              onRemove={() => {
                close(true);
                onRemove();
              }}
              onClose={() => close(true)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
