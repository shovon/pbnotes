import { useMemo } from 'react';
import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import { remarkPlugins } from '../../../shared/wikilink/wikilink';

/**
 * One block in its two states. Neither reaches main: the page decides what a
 * commit means and what gets appended to the log, these two only render text
 * and say when the user is done with it.
 */

/**
 * Where in a block's source text a click landed, so the caret can open there
 * instead of at the top. Best effort by design: what was clicked is the
 * *rendered* text, and markdown means the source is a different string —
 * `## Shed` renders three characters shorter than it is written.
 *
 * So: take the run of text that was clicked, and if it appears exactly once
 * in the source, count from there — which absorbs whatever syntax sits in
 * front of it. Anything ambiguous or rewritten (a link's label, a list
 * bullet, two identical paragraphs) gives up and lets the caret start at the
 * top, because a caret in the wrong place is worse than a caret at the
 * beginning: the user is about to type there.
 */
function sourceOffset(
  event: { clientX: number; clientY: number },
  text: string,
): number | undefined {
  const position = document.caretPositionFromPoint(
    event.clientX,
    event.clientY,
  );
  const node = position?.offsetNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return undefined;
  const run = node.textContent ?? '';
  const at = text.indexOf(run);
  if (at === -1 || text.indexOf(run, at + 1) !== -1) return undefined;
  return at + position.offset;
}

/**
 * Every metric a block shares between its two states, so clicking one swaps
 * rendered Markdown for a textarea in place and the only thing that visibly
 * changes is where the caret is — Logseq's model. No borders, no box that
 * appears or disappears under the text; the dot is the one mark a block
 * carries, and it is painted the same way in both.
 *
 * `box-border` and `wrap-break-word` are stated rather than left to a UA sheet
 * that treats a div and a textarea differently: the same words have to wrap
 * at the same points in both, or the box changes height as it opens. The
 * min-height keeps an empty block one line tall, with its dot inside it and
 * something to aim a click at.
 */
export const blockBox =
  'bullet box-border block min-h-[1.5em] w-full rounded-sm py-0.5 pr-1 pl-indent text-left leading-normal wrap-break-word';

/**
 * Nothing on hover — Logseq leaves the text alone. Keyboard focus still has
 * to be visible, though: without a border there is no other sign of where
 * you are.
 */
export const blockFocus =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

/**
 * Not a <button>: Markdown emits block elements, and a button may not contain
 * them. A div with the button role keeps the click-to-edit affordance
 * reachable and announced.
 */
export function Block({
  id,
  text,
  onActivate,
}: {
  /** Put on the element as `data-block-id`, so a view can scroll to it. */
  id?: string;
  text: string;
  /** The offset the click landed on, when it could be worked out. */
  onActivate: (caret?: number) => void;
}) {
  /**
   * Parsed once per text, not once per render. `Markdown` parses in render,
   * and every write re-renders the whole stack more than once — so without
   * this, a journal of a few thousand blocks pays for every one of them, and
   * every formula in them, on each keystroke that lands.
   */
  const rendered = useMemo(
    () => (
      <Markdown
        remarkPlugins={remarkPlugins}
        /**
         * KaTeX throws on malformed TeX by default, which would take the
         * whole page down over a half-typed formula. Bad math renders as
         * flagged source instead; the note is still readable and still
         * editable.
         */
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
      >
        {text}
      </Markdown>
    ),
    [text],
  );

  const box = (
    <div
      data-block-id={id}
      className={`${blockBox} ${blockFocus} markdown cursor-text`}
      role="button"
      tabIndex={0}
      onClick={(event) => onActivate(sourceOffset(event, text))}
      onKeyDown={(event) => {
        // A wikilink inside the block is focusable in its own right, and
        // Enter on it is the browser's own click — synthesised from this very
        // keydown's default action, which the preventDefault below would
        // cancel. Only a key on the block itself opens the editor. (The div
        // is a button role, so assistive tech folds the link into the
        // button's name; DOM focus still reaches it by Tab.)
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {rendered}
    </div>
  );
  if (!id) return box;

  /* The dot goes to the block: a link laid over the painted one, which the
     project view follows by its `data-block-ref`. Beside the box, not in it —
     inside, it would be the first child the Markdown margins are trimmed by. */
  return (
    <div className="relative">
      {box}
      <a
        href="#"
        data-block-ref={id}
        aria-label="Go to block"
        className="absolute top-0 left-0 h-7 w-indent cursor-pointer"
      />
    </div>
  );
}

/**
 * The box while it is being written in. One implementation for both the new
 * block and an existing one, so the commit rules cannot drift apart: blur
 * commits, Escape unmounts the box before blur can fire and so discards —
 * which is how the rename field in the project list behaves too.
 *
 * Enter ends the block and opens the next one, the way it sends a message
 * everywhere else; Shift+Enter is the newline. Blocks are short far more
 * often than they are multi-line, so the common key does the common thing
 * and the rarer one takes the modifier. ⌘/Ctrl+Enter still commits too — it
 * falls out of the same condition, and it is what the other hand reaches for.
 *
 * Backspace in an empty box deletes the block. Which makes deleting one the
 * same motion as clearing it — select all, Backspace, Backspace — and that is
 * the point: the first press empties the box and writes nothing, so the user
 * is looking at the consequence before the second press commits to it. In a
 * box for a block that does not exist yet the same key backs out of it
 * instead; the page decides which, this box only reports the press.
 */
export function BlockEditor({
  initial,
  caret,
  placeholder,
  onCommit,
  onContinue,
  onBackspace,
  onIndent,
  onCancel,
}: {
  initial?: string;
  /** Where to put the caret; the end of the text if it is past it. */
  caret?: number;
  placeholder?: string;
  onCommit: (text: string) => void;
  /**
   * Commit, then open a fresh box directly beneath this block. Like
   * `onCancel`, it has to unmount the box: blur would otherwise fire on the
   * way out and commit the same text a second time.
   */
  onContinue?: (text: string) => void;
  /**
   * Backspace in an already-empty box. Unmounts the box like `onCancel` does,
   * and for a sharper reason: letting blur fire on the way out would commit
   * the empty text first, and the log would keep a block emptied and then
   * deleted — an edit the user never made, on their way to doing something
   * else.
   *
   * Named for the key rather than for deleting, because deleting is only what
   * it means over a block that exists. Over one that does not it writes
   * nothing at all and just moves: Backspace at the start of a line is how
   * you back out of a block you did not mean to start, and the box that has
   * nothing to delete still owes the user that.
   */
  onBackspace?: () => void;
  /**
   * Tab, and Shift+Tab as `by: -1`. One handler for both because the box does
   * the same thing either way: hand back the text and where the caret was,
   * since moving the block closes and reopens this box and the caret has to
   * come back to the character it was on.
   *
   * Left off where there is nothing to move, which keeps Tab as the focus
   * key it is everywhere else.
   */
  onIndent?: (text: string, caret: number, by: 1 | -1) => void;
  onCancel: () => void;
}) {
  return (
    /* Grows with what is typed instead of standing at a fixed height with a
       scrollbar inside it — a block is as tall as its text in both states. */
    <textarea
      className={`${blockBox} field-sizing-content min-h-[calc(1.5em+--spacing(1))] resize-none outline-none placeholder:text-muted`}
      autoFocus
      /* Runs on mount, before or after autoFocus — focusing a textarea keeps
         whatever selection it already has, so either order lands here. */
      ref={(element) => {
        if (!element || caret === undefined) return;
        const at = Math.min(caret, element.value.length);
        element.setSelectionRange(at, at);
      }}
      /* One line to start with; the CSS grows the box from there. */
      rows={1}
      defaultValue={initial}
      placeholder={placeholder}
      /* The window losing focus blurs the box too, but that is the user
         looking elsewhere, not leaving the block: the browser hands focus
         back to this same box when the window returns, so stay open. */
      onBlur={(event) => {
        if (!document.hasFocus()) return;
        onCommit(event.target.value.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
        /**
         * Read before the key applies, so the box has to have been empty
         * *already* — the press that clears a full box is an ordinary
         * Backspace, and only the next one deletes.
         *
         * `isComposing` again: an IME uses Backspace to walk back through a
         * half-built character, and the buffer it is walking through may not
         * be in `value` yet.
         */
        if (
          onBackspace &&
          event.key === 'Backspace' &&
          !event.currentTarget.value &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          onBackspace();
        }
        /**
         * Tab moves the block a level in rather than moving focus, and
         * Shift+Tab a level out. Both are swallowed even when the move turns
         * out to be impossible: a block at the edge of what it can do should
         * sit still, not throw the user out of the box they are writing in.
         */
        if (onIndent && event.key === 'Tab') {
          event.preventDefault();
          onIndent(
            event.currentTarget.value.trim(),
            event.currentTarget.selectionStart,
            event.shiftKey ? -1 : 1,
          );
        }
        /**
         * `isComposing` is not a nicety: an IME takes Enter to choose among
         * candidates, and committing the block there would make a whole
         * class of languages untypeable a character or two at a time.
         *
         * Guarded on `onContinue` as well, so a box with nowhere to continue
         * to keeps Enter as an ordinary newline rather than swallowing it.
         */
        if (
          onContinue &&
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          onContinue(event.currentTarget.value.trim());
        }
      }}
    />
  );
}
