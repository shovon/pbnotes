import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { canonicalize } from '@pbnotes/graph';
import type { HeldAlias, Inert } from '@pbnotes/graph';
import { Signpost } from 'lucide-react';
import Icon from '../../../Icon/Icon';
import { arrive } from '../arrive';
import { adding, refusal, told } from './adding/adding';

type Props = {
  /**
   * The aliases as drawn: main's, with this view's writes in flight over
   * them, ordered by `canonicalize`, each with why it is inert when it is.
   */
  aliases: HeldAlias[];
  /** The page's title, which is never one of its aliases. */
  title: string;
  /**
   * The name the page was opened by, when it is not its title: the chip for
   * it is lit, the way Wikipedia says "Redirected from".
   */
  opened?: string;
  /** Why a name would not open this page, were it added: the hint under the input. */
  explain?: (alias: string) => Promise<Inert | undefined>;
  /** An alias to add, trimmed, that the row does not hold. */
  onAdd: (alias: string) => void;
  /** The × on a chip, with its alias as drawn. */
  onRemove: (alias: string) => void;
};

/**
 * A page's aliases as chips (#383), and an input to add one. A sibling of
 * `Tags`, not a use of it: a chip is plain text, not a link, since every
 * alias opens this same page, and the input says what a name would do
 * rather than offering titles, since an alias is usually a name nothing
 * uses yet. To fix a typo, remove the alias and add it again.
 *
 * "Add alias" is marked `data-reveal`, and the row `data-bare` with no
 * chips and no input open, as `Tags` is, for `PageView` to hide and lay out
 * the same way. Opening the input counts as having one, and points at it
 * (`arrive`). While the input is open the row is marked `data-typing`.
 *
 * Enter adds what is typed, even an alias the hint says will do nothing,
 * since a sync can change that later, and keeps the input open. The page's
 * own title and a `YYYY-MM-DD` are refused, and an alias the row holds
 * flashes its chip. Escape closes the input, and so does focus leaving it,
 * dropping what was typed. Switching windows is not leaving.
 *
 * An alias that does not open the page is dimmed, and its tooltip says why
 * in the hint's words.
 */
export default function Aliases({ aliases, title, opened, explain, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const chips = useRef(new Map<string, HTMLElement>());
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const names = aliases.map((it) => it.alias);

  /* The first alias's input opens where the chips will be, not where "Add
     alias" was: point at it. Not on later opens. */
  useEffect(() => {
    if (open && aliases.length === 0) arrive(input.current);
  }, [open]);

  const close = () => {
    setOpen(false);
    setTyped('');
  };

  /** Points at a chip the page already has. */
  const flash = (alias: string) =>
    chips.current
      .get(canonicalize(alias))
      ?.animate([{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }, {}], {
        duration: 500,
      });

  const decision = adding(names, title, open ? typed : '');

  /** Adds what is typed, unless it is blank, refused or held, and keeps the input open. */
  const add = () => {
    if (decision.kind === 'blank' || decision.kind === 'self' || decision.kind === 'date') return;
    setTyped('');
    if (decision.kind === 'held') return flash(decision.alias);
    onAdd(decision.alias);
  };

  // ── The hint ─────────────────────────────────────────────────────────────

  /** What main says of the name typed, and the name it said it of. */
  const [said, setSaid] = useState<{ alias: string; inert: Inert } | null>(null);
  const asking = decision.kind === 'add' ? decision.alias : '';

  /* A late answer to an older name is dropped. */
  useEffect(() => {
    if (!asking || !explain) return setSaid(null);
    let live = true;
    explain(asking).then(
      (inert) => live && setSaid(inert ? { alias: asking, inert } : null),
      () => live && setSaid(null),
    );
    return () => {
      live = false;
    };
  }, [asking]);

  const hint =
    decision.kind === 'self' || decision.kind === 'date'
      ? refusal(decision.kind, typed.trim())
      : said && said.alias === asking
        ? told(said.alias, said.inert)
        : undefined;

  // ── Keys and focus ───────────────────────────────────────────────────────

  /** Enter while composing is the IME's: it picks among candidates. */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  /** Focus leaving the input, not the window. */
  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (!document.hasFocus()) return;
    if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
    close();
  };

  const lit = opened === undefined ? undefined : canonicalize(opened);

  return (
    <div
      aria-label="Aliases"
      role="group"
      data-bare={aliases.length === 0 && !open ? '' : undefined}
      data-typing={open ? '' : undefined}
      className="mb-2 flex flex-wrap items-start gap-1.5 text-sm"
    >
      {(aliases.length > 0 || open) && <span className="py-0.5 text-muted">also called</span>}

      {aliases.map(({ alias, inert }) => {
        const key = canonicalize(alias);
        const isLit = key === lit;
        const tip = [isLit && `Opened from ${opened}`, inert && told(alias, inert)]
          .filter(Boolean)
          .join('. ');
        return (
          <span
            key={key}
            ref={(element) => {
              if (element) chips.current.set(key, element);
              else chips.current.delete(key);
            }}
            title={tip || undefined}
            data-inert={inert ? '' : undefined}
            data-opened={isLit ? '' : undefined}
            className={`group/chip inline-flex max-w-full min-w-0 items-start rounded-md bg-line/60 ${
              inert ? 'text-muted opacity-60' : 'text-fg'
            } ${isLit ? 'ring-1 ring-accent' : ''}`}
          >
            <span className="min-w-0 py-0.5 pr-0.5 pl-2 break-words">{alias}</span>
            {/* Keeps its room while hidden, so a chip does not change width
                under the pointer. */}
            <button
              type="button"
              aria-label={`Remove ${alias}`}
              className="rounded-md py-0.5 pr-1.5 pl-0.5 opacity-0 group-hover/chip:opacity-100 hover:text-danger focus-visible:opacity-100"
              onClick={() => onRemove(alias)}
            >
              ×
            </button>
          </span>
        );
      })}

      {open ? (
        <span className="relative">
          <input
            ref={input}
            autoFocus
            aria-label="Alias"
            placeholder="Alias"
            value={typed}
            data-undo="document"
            aria-describedby={hint ? hintId : undefined}
            aria-invalid={decision.kind === 'self' || decision.kind === 'date' ? true : undefined}
            className="field-sizing-content min-w-24 rounded-md bg-transparent px-2 py-0.5 outline-none ring-1 ring-line placeholder:text-muted"
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          />
          {hint && (
            <span
              id={hintId}
              role="status"
              className="absolute top-full left-0 z-10 mt-1 w-max max-w-72 rounded-sm border border-line bg-bg px-2 py-1 text-xs text-muted shadow-md"
            >
              {hint}
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          data-reveal
          className="inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 not-first:ml-1.5 text-muted hover:text-fg focus-visible:text-fg"
          onClick={() => setOpen(true)}
        >
          <Icon of={Signpost} />
          Add alias
        </button>
      )}
    </div>
  );
}
