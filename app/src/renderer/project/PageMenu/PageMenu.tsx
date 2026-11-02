import { useRef, useState } from 'react';
import type { PagesApi } from '../../../shared/pages';
import type { Act } from '../../ui';
import DeletePage from './DeletePage/DeletePage';
import type { DeleteImpact } from './DeletePage/wording/wording';

export type PageMenuProps = {
  /** The page on show, as it shows. */
  title: string;
  /** Whether anything is on it to delete. */
  canDelete: boolean;
  /**
   * What a delete would leave pointing at it, from the view on show. Read
   * live, so an open confirmation follows the page as it changes.
   */
  impact: DeleteImpact;
  /** The part of the bridge the menu calls. */
  pages: Pick<PagesApi, 'pageMenu'>;
  /** The delete was confirmed. */
  onDelete: () => void;
  act: Act;
};

/**
 * The page's ⋯ button, floating in the top-right corner of the window just
 * under the titlebar, where it stays as the page scrolls. It belongs to the
 * page, not the window, so it is not in the titlebar strip: that is for
 * where you are, not for acting on what is there.
 *
 * The menu is native and main draws it; the pick comes back here. Delete
 * Page… is always listed, and disabled for a page with nothing on it.
 * Choosing it always confirms, saying what the delete would leave behind.
 */
export default function PageMenu({ title, canDelete, impact, pages, onDelete, act }: PageMenuProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  const open = () =>
    act(async () => {
      const rect = button.current?.getBoundingClientRect();
      const pick = await pages.pageMenu(
        { x: rect?.left ?? 0, y: rect?.bottom ?? 0 },
        { delete: canDelete },
      );
      if (pick === 'delete') setConfirming(true);
    });

  return (
    <>
      <button
        ref={button}
        aria-label="Page actions"
        title="Page actions"
        className="fixed right-4 top-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar))+--spacing(2))] z-10 cursor-pointer rounded-md border border-transparent bg-bg px-1.5 py-0.5 leading-none text-muted hover:border-accent hover:text-accent"
        onClick={open}
      >
        ⋯
      </button>
      {confirming && (
        <DeletePage
          title={title}
          impact={impact}
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
