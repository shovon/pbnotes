import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

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
 * Not a <button>: Markdown emits block elements, and a button may not contain
 * them. A div with the button role keeps the click-to-edit affordance
 * reachable and announced.
 */
export function Block({
  text,
  onActivate,
}: {
  text: string;
  /** The offset the click landed on, when it could be worked out. */
  onActivate: (caret?: number) => void;
}) {
  return (
    <div
      className="block"
      role="button"
      tabIndex={0}
      onClick={(event) => onActivate(sourceOffset(event, text))}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      <Markdown
        remarkPlugins={[remarkMath]}
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
 * is looking at the consequence before the second press commits to it.
 */
export function BlockEditor({
  initial,
  caret,
  placeholder,
  onCommit,
  onContinue,
  onDelete,
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
   * Backspace in an empty box. Unmounts the box like `onCancel` does, and for
   * a sharper reason: letting blur fire on the way out would commit the empty
   * text first, and the log would keep a block emptied and then deleted —
   * an edit the user never made, on their way to doing something else.
   *
   * Left off for a block that does not exist yet: there is nothing to delete,
   * and Backspace in an empty new box should do what Backspace does.
   */
  onDelete?: () => void;
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
    <textarea
      className="block-input"
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
      onBlur={(event) => onCommit(event.target.value.trim())}
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
          onDelete &&
          event.key === 'Backspace' &&
          !event.currentTarget.value &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          onDelete();
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
