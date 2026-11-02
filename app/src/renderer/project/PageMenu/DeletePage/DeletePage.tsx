import { useEffect, useRef } from 'react';
import { wording } from './wording/wording';
import type { DeleteImpact } from './wording/wording';

export type DeletePageProps = {
  /** The page, as it shows. */
  title: string;
  /** What a delete leaves pointing at it from other pages. */
  impact: DeleteImpact;
  /** Delete, clicked or Enter. */
  onConfirm: () => void;
  /** Cancel, Escape, or a click outside the box. */
  onCancel: () => void;
};

/**
 * The confirmation before a page is deleted, which always shows. It says
 * what goes and what is left pointing at the page. Delete is not drawn as
 * dangerous: nothing leaves the disk, and the box has already said what it
 * does. It has the focus, so Enter confirms.
 */
export default function DeletePage({ title, impact, onConfirm, onCancel }: DeletePageProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  // Focus after `showModal`, not with `autoFocus`: React focuses on mount,
  // before the box is modal, and opening it then moves focus to the first
  // button in it, which is Cancel.
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
    confirm.current?.focus();
    return () => box?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="delete-page-title"
      className="mx-auto mt-[18vh] w-[min(28rem,calc(100vw-2rem))] rounded-md border border-line bg-bg p-4 text-fg shadow-xl backdrop:bg-fg/20"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <h2 id="delete-page-title" className="mb-2 text-base font-semibold">
        Delete “{title}”?
      </h2>
      {wording(title, impact).map((line) => (
        <p key={line} className="mb-2 text-sm">
          {line}
        </p>
      ))}
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="cursor-pointer rounded-md border border-line px-3.5 py-1.5 text-sm hover:border-accent hover:text-accent"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          ref={confirm}
          className="cursor-pointer rounded-md bg-accent px-3.5 py-1.5 text-sm text-on-accent hover:brightness-110"
          onClick={onConfirm}
        >
          Delete
        </button>
      </div>
    </dialog>
  );
}
