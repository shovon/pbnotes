import { useEffect, useId, useRef, useState } from 'react';
import { hitOf, marked, nothing, rows, step } from './results/results';
import type { Found, Hit, Row } from './results/results';

export type FinderProps = {
  /** Pages and blocks matching `query`. A rejection shows as no results. */
  find: (query: string) => Promise<Found>;
  /** A row was picked with Enter or a click. */
  onOpen: (hit: Hit) => void;
  /** Escape, or a click outside the box. */
  onClose: () => void;
};

/**
 * The Cmd/Ctrl+K box (#28): a query, and the pages and blocks that match it,
 * walked with Up and Down. Modal, so the page under it keeps its scroll and
 * focus goes back to where it was when the box closes.
 */
export default function Finder({ find, onOpen, onClose }: FinderProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found>(nothing);
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = rows(found);
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    const box = dialog.current;
    if (box && !box.open) box.showModal();
    return () => box?.close();
  }, []);

  /* A late answer to an older query is dropped. */
  useEffect(() => {
    if (!query.trim()) return setFound(nothing);
    let live = true;
    find(query).then(
      (answer) => {
        if (!live) return;
        setFound(answer ?? nothing);
        setActive(0);
      },
      () => live && setFound(nothing),
    );
    return () => {
      live = false;
    };
  }, [query]);

  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active, found]);

  const pick = (row: Row | undefined) => row && onOpen(hitOf(row));

  const option = (row: Row, index: number) => (
    <div
      key={row.kind === 'page' ? `p:${row.title}` : `b:${row.id}`}
      id={optionId(index)}
      role="option"
      aria-selected={index === active}
      className={`cursor-pointer px-3 py-1.5 ${index === active ? 'bg-accent text-on-accent' : ''}`}
      onMouseMove={() => setActive(index)}
      onClick={() => pick(row)}
    >
      {row.kind === 'page' ? (
        <div className="truncate">
          <Marked text={row.title} query={query} />
        </div>
      ) : (
        <>
          <div className="truncate">
            <Marked text={row.text} query={query} />
          </div>
          <div
            className={`truncate text-xs ${index === active ? 'text-on-accent/80' : 'text-muted'}`}
          >
            {row.page}
          </div>
        </>
      )}
    </div>
  );

  const group = (label: string, from: number, slice: Row[]) =>
    slice.length > 0 && (
      <div role="group" aria-label={label}>
        <div
          role="presentation"
          className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase"
        >
          {label}
        </div>
        {slice.map((row, index) => option(row, from + index))}
      </div>
    );

  return (
    <dialog
      ref={dialog}
      aria-label="Search pages and blocks"
      className="mx-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-line bg-bg text-fg shadow-xl backdrop:bg-fg/20"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <input
        autoFocus
        role="combobox"
        aria-expanded={list.length > 0}
        aria-controls={listId}
        aria-activedescendant={list.length > 0 ? optionId(active) : undefined}
        aria-autocomplete="list"
        placeholder="Search pages and blocks"
        className="w-full border-b border-line bg-transparent px-3 py-2.5 text-base outline-none"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          const by = { ArrowDown: 1, ArrowUp: -1 }[event.key];
          if (by) {
            event.preventDefault();
            setActive(step(active, by, list.length));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            pick(list[active]);
          }
        }}
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Results"
        className={`max-h-[60vh] overflow-y-auto ${list.length > 0 ? 'pb-1' : ''}`}
      >
        {group('Pages', 0, list.slice(0, found.pages.length))}
        {group('Blocks', found.pages.length, list.slice(found.pages.length))}
      </div>
      {query.trim() && list.length === 0 && (
        <p className="px-3 py-3 text-sm text-muted">No pages or blocks match.</p>
      )}
    </dialog>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  return marked(text, query).map((part, index) =>
    part.match ? (
      <strong key={index} className="font-semibold">
        {part.text}
      </strong>
    ) : (
      part.text
    ),
  );
}
