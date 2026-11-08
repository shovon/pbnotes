import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { canonicalize } from '@pbnotes/graph';
import { adding, offered } from './adding/adding';

type Props = {
  /** The tags as drawn: main's, with this view's writes in flight over them. */
  tags: string[];
  /** Titles that contain a query, for the tag being typed. */
  findTags?: (query: string) => Promise<string[]>;
  /** A tag to add, trimmed, that the row does not hold. */
  onAdd: (tag: string) => void;
  /** The × on a chip, with its tag as drawn. */
  onRemove: (tag: string) => void;
};

/**
 * A row of tags as chips, each a link to its page, and an input to add one:
 * the tags of whatever it is handed, which it never names.
 *
 * "+ Add tag" is marked `data-reveal`: whoever holds the row may hide it
 * until wanted, as `PageView` does until its header is hovered or focused.
 * The open input is not marked, so it stays shown until it closes.
 *
 * With no chips the row is marked `data-bare`, for a holder that lays it
 * out differently until the first tag is added. An open input does not
 * count: typing the first tag moves nothing. While the input is open the
 * row is marked `data-typing`.
 *
 * Enter adds what is typed and keeps the input open for the next. Escape
 * closes it, and so does focus leaving it, dropping what was typed rather
 * than adding a tag nobody confirmed. Switching windows is not leaving.
 */
export default function Tags({ tags, findTags, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const chips = useRef(new Map<string, HTMLElement>());

  const close = () => {
    setOpen(false);
    setTyped('');
  };

  /** Points at a chip the page already has. */
  const flash = (tag: string) =>
    chips.current
      .get(canonicalize(tag))
      ?.animate([{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }, {}], {
        duration: 500,
      });

  /** Adds `text`, unless it is blank or held, and keeps the input open. */
  const add = (text: string) => {
    const decision = adding(tags, text);
    if (decision.kind === 'blank') return;
    setTyped('');
    if (decision.kind === 'held') return flash(decision.tag);
    onAdd(decision.tag);
  };

  // ── Suggestions ──────────────────────────────────────────────────────────

  const [found, setFound] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listId = useId();
  const query = open ? typed.trim() : '';
  const shown = query !== '' && query !== dismissed ? offered(found, tags) : [];

  /* A late answer to an older query is dropped. */
  useEffect(() => {
    if (!query || !findTags) return setFound([]);
    let live = true;
    findTags(query).then(
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

  // ── Keys and focus ───────────────────────────────────────────────────────

  /**
   * Enter and Escape are the list's while it is open, and the input's when
   * it is not. Enter while composing is the IME's: it picks among candidates.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const listing = shown.length > 0;
    if (listing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const by = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at) => (at + by + shown.length) % shown.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      add(listing ? shown[Math.min(active, shown.length - 1)] : typed);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (listing) setDismissed(query);
      else close();
    }
  };

  /** Focus leaving the input, not the window. */
  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (!document.hasFocus()) return;
    if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
    close();
  };

  return (
    <div
      aria-label="Tags"
      role="group"
      data-bare={tags.length === 0 ? '' : undefined}
      data-typing={open ? '' : undefined}
      className="mb-3 flex flex-wrap items-start gap-1.5 text-sm"
    >
      {tags.map((tag) => (
        <span
          key={canonicalize(tag)}
          ref={(element) => {
            if (element) chips.current.set(canonicalize(tag), element);
            else chips.current.delete(canonicalize(tag));
          }}
          className="group/chip inline-flex max-w-full min-w-0 items-start rounded-md bg-accent/10 text-accent"
        >
          {/* The project view follows it like any wikilink. */}
          <a
            className="wikilink min-w-0 py-0.5 pr-0.5 pl-2 break-words hover:underline"
            href={`#${tag}`}
          >
            {tag}
          </a>
          {/* Keeps its room while hidden, so a chip does not change width
              under the pointer. */}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="rounded-md py-0.5 pr-1.5 pl-0.5 opacity-0 group-hover/chip:opacity-100 hover:text-danger focus-visible:opacity-100"
            onClick={() => onRemove(tag)}
          >
            ×
          </button>
        </span>
      ))}

      {open ? (
        <span className="relative">
          <input
            autoFocus
            aria-label="Tag"
            placeholder="Tag"
            value={typed}
            data-undo="document"
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls={listId}
            aria-activedescendant={shown.length > 0 ? `${listId}-${active}` : undefined}
            className="field-sizing-content min-w-24 rounded-md bg-transparent px-2 py-0.5 outline-none ring-1 ring-line placeholder:text-muted"
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          />
          {shown.length > 0 && (
            /* Mouse-down rather than click, and kept from taking focus: a
               blur would close the input before the pick lands in it. */
            <ul
              id={listId}
              role="listbox"
              aria-label="Pages"
              className="absolute top-full left-0 z-10 mt-1 w-64 overflow-hidden rounded-sm border border-line bg-bg py-1 shadow-md"
            >
              {shown.map((title, index) => (
                <li
                  key={title}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`cursor-pointer truncate px-2 py-0.5 ${index === active ? 'bg-accent text-on-accent' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    add(title);
                  }}
                >
                  {title}
                </li>
              ))}
            </ul>
          )}
        </span>
      ) : (
        <button
          type="button"
          data-reveal
          className="cursor-pointer rounded-md px-2 py-0.5 text-muted hover:text-fg focus-visible:text-fg"
          onClick={() => setOpen(true)}
        >
          + Add tag
        </button>
      )}
    </div>
  );
}
