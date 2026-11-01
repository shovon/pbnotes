import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';
import { canonicalize } from '@pbnotes/pages';
import type { Property } from '@pbnotes/pages';
import { commit, draft, editable, keyless, shown, suggested } from './rows';
import type { Open, Write } from './rows';

type Props = {
  /** The rows as drawn: main's, with this view's writes in flight over them. */
  rows: Property[];
  /** Titles that contain a query, for the key being typed. */
  findKeys?: (query: string) => Promise<string[]>;
  /** A row was left with something to write. Never called with none. */
  onCommit: (writes: Write[]) => void;
  /** The × on a row, with its key as drawn. */
  onRemove: (key: string) => void;
};

const row = 'col-span-3 grid grid-cols-subgrid';
const keyCell = 'relative cursor-text bg-line/40 px-3 py-2';
const valueCell = 'min-w-0 cursor-text px-3 py-2';
const input = 'bg-transparent outline-none placeholder:text-muted';

/**
 * A table of key/value rows: the properties of whatever it is handed, which
 * it never names. The page is the caller's, so a later view of a block's
 * properties can use this unchanged.
 *
 * One row is open at a time, as one block box is: a written row clicked
 * into, or a draft at the bottom. A row is one edit: moving between its two
 * cells writes nothing, and leaving it (focus going anywhere outside it, or
 * Enter) writes what `commit` decides. Escape throws the edit away. Switching
 * windows is not leaving anything.
 *
 * What is written is drawn by the caller, through the rows it hands back. The
 * open row is keyed by the key it was opened on, so it stays mounted, caret
 * and all, while new rows arrive around it, even one without it.
 */
export default function Properties({ rows, findKeys, onCommit, onRemove }: Props) {
  const [open, setOpenState] = useState<Open | null>(null);
  /**
   * The open row as it is now, for the blur that a closing row fires on its
   * way out. A row's handlers compare it with the row they were drawn for, so
   * a row already closed, or replaced by the draft Enter opened, does
   * nothing when it blurs.
   */
  const current = useRef<Open | null>(null);
  const setOpen = (next: Open | null) => {
    current.current = next;
    setOpenState(next);
  };
  /** The cell the next row to open puts the caret in. */
  const [focus, setFocus] = useState<'key' | 'value'>('key');
  const keyBox = useRef<HTMLDivElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);

  /** Points at the key, the cell that has to change before the row can be left. */
  const flash = () =>
    keyBox.current?.animate([{ backgroundColor: 'var(--color-line)' }, {}], { duration: 500 });

  /**
   * Leaves the open row, writing what it asks for. Refused for a key that is
   * another row's: the cell flashes and the row stays open, focused or not,
   * so what was typed is still there to fix.
   */
  const leave = (): boolean => {
    const it = current.current;
    if (!it) return true;
    const decision = commit(rows, it);
    if (decision.kind === 'taken') {
      flash();
      return false;
    }
    setOpen(null);
    if (decision.writes.length > 0) onCommit(decision.writes);
    return true;
  };

  /**
   * Each draft is a new row to React, so the one Enter opens mounts fresh,
   * caret in its key, rather than taking over the inputs of the one left.
   */
  const drafts = useRef(0);

  /** Opens `next`, with the caret in `cell`. */
  const start = (next: Open, cell: 'key' | 'value') => {
    if (!next.from) drafts.current++;
    setFocus(cell);
    setOpen(next);
  };

  /**
   * Enter: the row is left, and a draft opens at the bottom for the next
   * property. Not from a draft with no key yet, which would only open
   * another: the key flashes instead.
   */
  const enter = () => {
    const it = current.current;
    if (!it) return;
    if (keyless(it)) return flash();
    if (leave()) start(draft(), 'key');
  };

  /** Escape: the edit is thrown away, and nothing is written. */
  const discard = () => setOpen(null);

  /**
   * Focus leaving `drawnFor`'s row. Moving between its own cells is not
   * leaving it, and neither is the window losing focus: coming back puts the
   * caret where it was.
   */
  const blurred = (drawnFor: Open) => (event: FocusEvent<HTMLDivElement>) => {
    if (current.current !== drawnFor || !document.hasFocus()) return;
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    leave();
  };

  /**
   * A press on a cell's padding would blur to the page before the click
   * lands, and leave the row. Mouse-down focuses the cell's input instead, so
   * the whole cell is the input.
   */
  const toInput = (event: MouseEvent<HTMLDivElement>) => {
    const field = event.currentTarget.querySelector('input');
    if (!field || event.target === field) return;
    event.preventDefault();
    field.focus();
  };

  // ── Suggestions for the key ──────────────────────────────────────────────

  const [keyFocused, setKeyFocused] = useState(false);
  const [found, setFound] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listId = useId();
  const query = open && keyFocused ? open.key.trim() : '';
  const offered = open && query !== '' && query !== dismissed ? suggested(found, rows, open) : [];

  /* A late answer to an older query is dropped. */
  useEffect(() => {
    if (!query || !findKeys) return setFound([]);
    let live = true;
    findKeys(query).then(
      (titles) => {
        if (!live) return;
        setFound(titles ?? []);
        setActive(0);
      },
      () => live && setFound([]),
    );
    return () => {
      live = false;
    };
  }, [query]);

  /** A title picked for the key; the caret goes on to the value. */
  const pick = (it: Open, title: string) => {
    setOpen({ ...it, key: title });
    setDismissed(title);
    valueInput.current?.focus();
  };

  // ── Keys ─────────────────────────────────────────────────────────────────

  /**
   * Enter and Escape are the list's while it is open, and the row's when it
   * is not. Enter while composing is the IME's: it picks among candidates.
   */
  const onKeyDown = (it: Open) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const listing = offered.length > 0 && event.currentTarget === keyInput.current;
    if (listing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const by = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at) => (at + by + offered.length) % offered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (listing) pick(it, offered[Math.min(active, offered.length - 1)]);
      else enter();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (listing) setDismissed(query);
      else discard();
    }
  };

  // ── Rows ─────────────────────────────────────────────────────────────────

  const editing = (it: Open, key: string) => (
    <div key={key} role="row" className={row} onBlur={blurred(it)}>
      <div role="cell" ref={keyBox} className={keyCell} onMouseDown={toInput}>
        <input
          ref={keyInput}
          aria-label="Key"
          placeholder="Key"
          autoFocus={focus === 'key'}
          value={it.key}
          role="combobox"
          aria-expanded={offered.length > 0}
          aria-controls={listId}
          aria-activedescendant={offered.length > 0 ? `${listId}-${active}` : undefined}
          className={`${input} field-sizing-content min-w-16 max-w-full`}
          onChange={(event) => setOpen({ ...it, key: event.target.value })}
          onFocus={() => setKeyFocused(true)}
          onBlur={() => setKeyFocused(false)}
          onKeyDown={onKeyDown(it)}
        />
        {offered.length > 0 && (
          /* Mouse-down rather than click, and kept from taking focus: a blur
             would leave the row before the pick lands in it. */
          <ul
            id={listId}
            role="listbox"
            aria-label="Pages"
            className="absolute top-full left-0 z-10 w-64 overflow-hidden rounded-sm border border-line bg-bg py-1 shadow-md"
          >
            {offered.map((title, index) => (
              <li
                key={title}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`cursor-pointer truncate px-2 py-0.5 ${index === active ? 'bg-accent text-on-accent' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(it, title);
                }}
              >
                {title}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div role="cell" className={valueCell} onMouseDown={toInput}>
        {it.from && !editable(it.from.value) ? (
          <span className="whitespace-pre-wrap">{it.value}</span>
        ) : (
          <input
            ref={valueInput}
            aria-label="Value"
            placeholder="Empty"
            autoFocus={focus === 'value'}
            value={it.value}
            className={`${input} w-full`}
            // A draft takes its key first: a value with nowhere to go is
            // only dropped.
            onFocus={() => keyless(it) && keyInput.current?.focus()}
            onChange={(event) => setOpen({ ...it, value: event.target.value })}
            onKeyDown={onKeyDown(it)}
          />
        )}
      </div>
      <div role="cell" />
    </div>
  );

  const resting = (property: Property, key: string) => (
    <div key={key} role="row" className={`group ${row}`}>
      <div
        role="cell"
        className={keyCell}
        // The key is a link to its page; a click anywhere else opens the row.
        onClick={(event) => {
          if ((event.target as Element).closest('a')) return;
          start({ from: property, ...property }, 'key');
        }}
      >
        <a className="wikilink text-accent hover:underline" href={`#${property.key}`}>
          {property.key}
        </a>
      </div>
      <div
        role="cell"
        className={editable(property.value) ? valueCell : `${valueCell} cursor-default`}
        onClick={() => start({ from: property, ...property }, editable(property.value) ? 'value' : 'key')}
      >
        {property.value === '' ? (
          <span className="text-muted">Empty</span>
        ) : (
          <span className="break-words whitespace-pre-wrap">{property.value}</span>
        )}
      </div>
      <div role="cell" className="flex items-center pr-1">
        <button
          type="button"
          aria-label={`Remove ${property.key}`}
          className="rounded-sm px-1.5 text-muted opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
          onClick={() => onRemove(property.key)}
        >
          ×
        </button>
      </div>
    </div>
  );

  const at = open?.from && canonicalize(open.from.key);
  const drawn = shown(rows, open);

  return (
    <section aria-label="Properties" className="mb-4 border-y border-line text-sm">
      {(drawn.length > 0 || open) && (
        <div
          role="table"
          aria-label="Properties"
          className="grid grid-cols-[minmax(6rem,max-content)_1fr_auto] divide-y divide-line border-b border-line"
        >
          {drawn.map((property) => {
            const key = canonicalize(property.key);
            return open && key === at ? editing(open, key) : resting(property, key);
          })}
          {open && !open.from && editing(open, `draft-${drafts.current}`)}
        </div>
      )}
      <button
        type="button"
        className="w-full px-3 py-2 text-left text-muted hover:bg-line/40 hover:text-fg focus-visible:bg-line/40 focus-visible:text-fg focus-visible:outline-none"
        onClick={() => start(draft(), 'key')}
      >
        + Add property
      </button>
    </section>
  );
}
