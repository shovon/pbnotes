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
 */
export function BlockEditor({
  initial,
  caret,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial?: string;
  /** Where to put the caret; the end of the text if it is past it. */
  caret?: number;
  placeholder?: string;
  onCommit: (text: string) => void;
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
      }}
    />
  );
}
