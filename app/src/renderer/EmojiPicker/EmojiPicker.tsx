import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Shuffle } from 'lucide-react';
import data from 'emojibase-data/en/data.json';
import { catalog, randomOf, recentOf, search, sections } from './catalog/catalog';
import type { Entry, Section } from './catalog/catalog';
import { move, rowsOf } from './grid/grid';
import type { Arrow } from './grid/grid';

/** Everything the picker offers, read once: the data never changes while the app runs. */
const ALL = catalog(data);
const SECTIONS = sections(ALL);

/** Cells to a row. The grid's class (`grid-cols-8`) says the same. */
const COLUMNS = 8;

const ARROWS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export type EmojiPickerProps = {
  /** The emoji chosen now, if any. *Remove* shows only when there is one. */
  value?: string;
  /**
   * What was chosen lately, most recent first, as the caller keeps it. Shown
   * above the groups; a string that is not an emoji the picker offers is
   * passed over.
   */
  recent: readonly string[];
  /** A number in [0, 1), as `Math.random` gives one: what *Random* picks with. */
  random: () => number;
  /** An emoji was chosen: clicked, Enter, or *Random*. */
  onPick: (emoji: string) => void;
  /** *Remove* was pressed. */
  onRemove: () => void;
  /** Escape. Focus goes back where it was once the picker is gone. */
  onClose: () => void;
};

/**
 * Choosing one emoji (#325): a search by name and keyword, what was used
 * lately, every emoji by group, and a random one. Knows nothing of pages or
 * the graph: it is handed what is chosen now, and says what was chosen.
 * Where it sits on screen is the caller's.
 *
 * Focus is in the search box from the start and stays there: the arrow keys
 * move through the grid and Enter picks, as in a combobox. When the picker
 * goes, focus goes back to what had it before, if it is still in the picker
 * or nowhere.
 */
export default function EmojiPicker({
  value,
  recent,
  random,
  onPick,
  onRemove,
  onClose,
}: EmojiPickerProps) {
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const cellId = (index: number) => `${listId}-${index}`;

  const shown: Section[] = useMemo(() => {
    if (query.trim()) return [{ label: 'Results', entries: search(ALL, query) }];
    const lately = recentOf(ALL, recent).slice(0, COLUMNS * 2);
    return lately.length > 0 ? [{ label: 'Recently used', entries: lately }, ...SECTIONS] : SECTIONS;
  }, [query, recent]);
  const cells = useMemo(() => shown.flatMap((section) => section.entries), [shown]);
  const rows = useMemo(() => rowsOf(shown.map((it) => it.entries.length), COLUMNS), [shown]);
  const current: Entry | undefined = cells[active];

  useEffect(() => {
    const opener = document.activeElement;
    input.current?.focus();
    return () => {
      const now = document.activeElement;
      const lost = !now || now === document.body || panel.current?.contains(now);
      if (lost && opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    document.getElementById(cellId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active, shown]);

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (ARROWS.has(event.key)) {
      event.preventDefault();
      setActive(move(rows, active, event.key as Arrow));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (current) onPick(current.emoji);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const pickRandom = () => {
    const it = randomOf(ALL, random);
    if (it) onPick(it.emoji);
  };

  let index = 0;
  const cell = (entry: Entry) => {
    const at = index++;
    return (
      <div
        key={`${at}:${entry.emoji}`}
        id={cellId(at)}
        role="option"
        aria-selected={at === active}
        aria-label={entry.label}
        className={`flex size-9 cursor-pointer items-center justify-center rounded text-2xl leading-none ${
          at === active ? 'bg-line' : ''
        }`}
        onMouseMove={() => setActive(at)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(entry.emoji)}
      >
        {entry.emoji}
      </div>
    );
  };

  const button =
    'shrink-0 rounded px-2 py-1 text-sm text-muted hover:bg-line hover:text-fg focus-visible:outline-2 focus-visible:outline-accent';

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose an emoji"
      className="flex w-[19.75rem] flex-col overflow-hidden rounded-md border border-line bg-bg text-fg shadow-xl"
    >
      <div className="flex items-center gap-1 border-b border-line p-1.5">
        <input
          ref={input}
          role="combobox"
          aria-label="Search emoji"
          aria-expanded={cells.length > 0}
          aria-controls={listId}
          aria-activedescendant={current ? cellId(active) : undefined}
          aria-autocomplete="list"
          placeholder="Search emoji"
          className="min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-sm outline-none"
          value={query}
          /* A history of its own, never the document's: a search writes nothing (#247). */
          data-undo="field"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={keyDown}
        />
        <button type="button" className={button} aria-label="Random" title="Random" onClick={pickRandom}>
          <Shuffle className="size-4" aria-hidden />
        </button>
        {value !== undefined && (
          <button type="button" className={button} onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <div id={listId} role="listbox" aria-label="Emoji" className="h-72 overflow-y-auto px-1.5 pb-1.5">
        {cells.length === 0 ? (
          <p className="px-1.5 py-6 text-center text-sm text-muted">No emoji match “{query.trim()}”</p>
        ) : (
          shown.map(
            (section) =>
              section.entries.length > 0 && (
                <div key={section.label} role="group" aria-label={section.label}>
                  <div
                    role="presentation"
                    className="sticky top-0 bg-bg px-1 pt-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase"
                  >
                    {section.label}
                  </div>
                  <div className="grid grid-cols-8">{section.entries.map(cell)}</div>
                </div>
              ),
          )
        )}
      </div>
      <div className="flex h-10 items-center gap-2 border-t border-line px-3 text-sm" aria-hidden>
        {current && (
          <>
            <span className="text-xl leading-none">{current.emoji}</span>
            <span className="truncate text-muted first-letter:uppercase">{current.label}</span>
          </>
        )}
      </div>
    </div>
  );
}
