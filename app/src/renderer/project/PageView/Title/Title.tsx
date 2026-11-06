import { useEffect, useRef, useState } from 'react';
import { humanize } from '../../../humanize/humanize';
import { wanted } from './wanted';

type Props = {
  /** The page's title, as main last showed it. */
  title: string;
  /**
   * Renames the page to `to`. Resolves once main has written it; rejects
   * with main's reason when it refuses, which the field shows.
   */
  onRename: (to: string) => Promise<unknown>;
};

/**
 * A page's title on its own view, edited in place (#109). Click it to edit.
 * Enter or leaving the field renames the page; Escape puts the title back.
 * A blank title, or the same one, renames nothing.
 *
 * A refused rename keeps the field open with what was typed, and says why
 * under it. Leaving the field again without changing that text does not
 * ask a second time; Escape is the way out.
 *
 * The page arrives under its new title from main, a moment after the
 * rename is written. Until then this shows the title it was renamed to.
 */
export default function Title({ title, onRename }: Props) {
  /** What is typed, while the field is open; null while it is not. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Why the last rename was refused, while the field still holds what was refused. */
  const [reason, setReason] = useState<string | null>(null);
  /** The title renamed to, shown until the page arrives under it. */
  const [renamedTo, setRenamedTo] = useState<string | null>(null);
  const refused = useRef<string | null>(null);
  const busy = useRef(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => setRenamedTo(null), [title]);

  const shown = renamedTo ?? title;

  const close = () => {
    setDraft(null);
    setReason(null);
    refused.current = null;
  };

  const commit = async () => {
    if (draft === null || busy.current) return;
    const to = wanted(draft, shown);
    if (to === undefined) return close();
    busy.current = true;
    try {
      await onRename(to);
      setRenamedTo(to);
      close();
    } catch (error) {
      refused.current = draft;
      setReason(humanize(error));
      field.current?.focus();
    } finally {
      busy.current = false;
    }
  };

  if (draft === null) {
    return (
      <h2 className="mt-6 mb-4 text-2xl font-semibold">
        <button
          type="button"
          title="Rename"
          className="w-full cursor-text text-left break-words"
          onClick={() => setDraft(shown)}
        >
          {shown}
        </button>
      </h2>
    );
  }

  return (
    <div className="mt-6 mb-4">
      <h2 className="text-2xl font-semibold">
        <input
          ref={field}
          autoFocus
          aria-label="Page title"
          aria-invalid={reason !== null}
          aria-describedby={reason !== null ? 'page-title-refused' : undefined}
          value={draft}
          data-undo="document"
          className="-mx-1 w-[calc(100%+0.5rem)] rounded-md bg-transparent px-1 outline-none ring-1 ring-line aria-invalid:ring-danger"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
          onBlur={() => {
            if (reason !== null && draft === refused.current) return;
            void commit();
          }}
        />
      </h2>
      {reason !== null && (
        <p id="page-title-refused" role="alert" className="mt-1 text-sm text-danger">
          {reason}
        </p>
      )}
    </div>
  );
}
