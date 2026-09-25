import { Fragment, useState } from 'react';
import type { Project } from '../../../shared/projects';
import { lastLeaf, locate } from '../../../shared/pages';
import type { Block as BlockType, Page } from '../../../shared/pages';
import type { Act } from '../../ui';
import { Block, BlockEditor } from '../Block/Block';

const { pages } = window.gnotes;

/**
 * Where an unwritten block is waiting to be typed. `after` is the block it
 * goes beneath; without one it goes at the end of the day. Null is no box
 * open at all — three states, because "writing" and "writing *here*" are
 * different questions and a boolean can only answer the first.
 */
type Writing = { after?: string } | null;

/**
 * The block `addBlock` just wrote, found by where it must have landed: the
 * fold splices it directly beneath `after` as its next sibling — wherever in
 * the tree that is — or pushes it last. Saves widening the IPC result to
 * carry an id back for the one caller that wants it.
 *
 * `locate`, not a scan of the top level: `after` is just as often a child,
 * and a miss there does not read as a miss — it reads as index 0, which is
 * the first block on the page.
 */
function created(page: Page, after?: string): string | undefined {
  if (!after) return page.blocks.at(-1)?.id;
  const found = locate(page.blocks, after);
  return found && found.siblings[found.at + 1]?.id;
}

type Props = {
  project: Project;
  /** The day as it folded when the stack was read. */
  initial: Page;
  act: Act;
};

/**
 * One day of a project: its blocks, and the editing that appends to them.
 *
 * The day arrives already folded, from the one read that fills the whole
 * stack, and every write hands the page straight back — so this owns its day
 * from then on and never asks main for it again. Nothing here is aware that
 * there are other days above and below it, which is what keeps a stack of
 * them the same component as a single one.
 */
export default function DayPage({ project, initial, act }: Props) {
  const date = initial.date;
  const [page, setPage] = useState<Page>(initial);
  const [writing, setWriting] = useState<Writing>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Where the click that opened the block landed. Undefined when there was no
  // click to read a position from — keyboard activation, or a new block.
  const [caret, setCaret] = useState<number | undefined>(undefined);

  /**
   * Text that came out of the box the way it went in is not an edit, and
   * appends nothing — the log takes facts, and it takes them forever.
   *
   * Emptying a block *is* an edit. A blank block is a legitimate thing to
   * want: a gap between two thoughts, or somewhere to come back to — which is
   * why clearing one and leaving commits the blank, and only a further
   * Backspace in the empty box means delete.
   */
  const commitEdit = (block: BlockType, text: string) => {
    setEditingId(null);
    if (text === block.text) return;
    act(async () => {
      setPage(await pages.editBlock(project.id, date, block.id, text));
    });
  };

  /**
   * Backspace in an already-empty box. Unmounts the editor first, so blur
   * cannot slip a `block.edited` to empty into the log ahead of the delete:
   * the user cleared the box on the way to removing the block, and an empty
   * block is not a thing they ever asked to keep.
   *
   * Then the box reopens on the block above, caret at its end. Backspace at
   * the start of a line is a movement as much as a deletion — it is how you
   * back out of a block you did not mean to start — so the keystroke never
   * leaves the user staring at a page with the focus dropped. Every case
   * below keeps them writing; they differ only in where.
   *
   * Above the first block there is nothing, so the edit continues *below* it
   * instead: caret at the start of the block that is about to become first,
   * which is the position the user's caret was already in. Not its end — the
   * text under the deleted block moves up to where the user is, rather than
   * the user moving down to it.
   *
   * Deleting the *only* block has no block on either side, and falls back to
   * the page itself: the same box a blank page already offers, opened rather
   * than waiting to be clicked.
   */
  const commitDelete = (block: BlockType) => {
    // A block with children is not deleted by this key. It is an empty line
    // with things filed under it, and handing a whole subtree to one
    // keystroke is not what emptying a box means. So: nothing at all — no
    // delete, no move, the box stays open where it is. Clear the last child
    // out and this same press removes the parent, which is the way back.
    if (block.children.length > 0) return;

    // Read before the delete lands, off the page still on screen.
    const blocks = page.blocks;
    const found = locate(blocks, block.id);
    // The block above in the order the page reads: the sibling above,
    // descended to its deepest last child, or — for a first child — the
    // block it is filed under. Only the page's very first block has neither,
    // which is why this is not simply the previous sibling.
    const above =
      found && found.at > 0
        ? lastLeaf(found.siblings[found.at - 1])
        : found?.parent;
    // Only for that first block. Guarded on the position rather than on
    // `above` so a block the page does not have falls through to neither.
    const below =
      found && found.at === 0 && !found.parent ? blocks[1] : undefined;
    setCaret(above ? above.text.length : 0);
    setEditingId(above?.id ?? below?.id ?? null);
    // Nothing either side: the page is about to be empty.
    if (!above && !below) setWriting({});
    act(async () => {
      setPage(await pages.deleteBlock(project.id, date, block.id));
    });
  };

  /**
   * Tab and Shift+Tab. Files the block under the sibling above it, or brings
   * it back out beneath what it was filed under — children and all, either
   * way — and leaves the user still writing in it.
   *
   * The box is closed before the move and reopened after rather than left
   * mounted: the block lands somewhere else in the rendered tree, which
   * unmounts the editor regardless, and letting that happen on its own would
   * fire blur on the way out and commit the same text a second time. Closing
   * first is the escape the delete and continue paths already take.
   *
   * At either edge — first among its siblings going in, already at the top
   * level coming out — there is nowhere to go, so the keystroke does nothing
   * and nothing is sent. Main refuses both too; the check is here only to
   * save a close-and-reopen for a move that will not happen.
   */
  const commitIndent = (
    block: BlockType,
    text: string,
    at: number,
    by: 1 | -1,
  ) => {
    const found = locate(page.blocks, block.id);
    if (!found) return;
    if (by === 1 ? found.at === 0 : !found.parent) return;
    const move = by === 1 ? pages.indentBlock : pages.outdentBlock;
    setEditingId(null);
    setCaret(at);
    act(async () => {
      // Tab is not a commit, but the box has to close to move and the text in
      // it would go with it. Unchanged text appends nothing, as ever.
      if (text !== block.text) {
        await pages.editBlock(project.id, date, block.id, text);
      }
      setPage(await move(project.id, date, block.id));
      setEditingId(block.id);
    });
  };

  /**
   * Writes the box that is open, and then either stops, opens another beneath
   * what it just wrote — which is what makes a run of blocks typeable without
   * reaching for the mouse between them — or indents what it wrote. Any of
   * those can only be placed once the append has come back, because until
   * then the block has no id.
   *
   * `indent` is Tab in a box for a block that does not exist yet, which is
   * the ordinary way an outline gets built: type, Enter, Tab. It takes two
   * events, because nothing can be filed under a block that was never
   * written. The user pressed one key, so the box reopens on what they were
   * typing in rather than closing.
   */
  const commitNew = (
    text: string,
    {
      then,
      caret,
    }: { then: 'stop' | 'again' | 'indent' | 'outdent'; caret?: number },
  ) => {
    const after = writing?.after;
    setWriting(null);

    /**
     * Enter on an empty box that is sitting among a block's children pops the
     * box out a level rather than writing anything. It looks like an outdent
     * and it is not one: nothing has been written, so there is no block to
     * move — the box just re-places itself beside the parent, which is where
     * a block typed there would have gone anyway.
     *
     * Repeats all the way out, a level per press, because each one leaves the
     * box beside its new parent and asks the same question again. At the top
     * level there is no parent left and Enter goes back to making a gap.
     */
    const parent = after
      ? locate(page.blocks, after)?.parent
      : undefined;
    if (!text && (then === 'again' || then === 'outdent') && parent) {
      setWriting({ after: parent.id });
      return;
    }

    // An empty block is written when it is *asked* for — Enter on an empty
    // box is how a gap gets made, and so is Tab. Blurring a box nothing was
    // ever typed into is a click that landed elsewhere, and writes nothing.
    if (!text && then === 'stop') return;
    act(async () => {
      const next = await pages.addBlock(project.id, date, text, after);
      setPage(next);
      const id = created(next, after);
      if (then === 'again') setWriting({ after: id });
      if ((then === 'indent' || then === 'outdent') && id) {
        setCaret(caret);
        // Nowhere to go — the first block of an empty page going in, a
        // top-level one coming out — comes back unchanged, and the box simply
        // reopens where it was.
        const move = then === 'indent' ? pages.indentBlock : pages.outdentBlock;
        setPage(await move(project.id, date, id));
        setEditingId(id);
      }
    });
  };

  /**
   * Backspace in an empty box for a block that does not exist yet. Nothing
   * was written, so nothing is deleted and nothing is appended: the box
   * closes and the caret goes to the end of the block directly above it,
   * which is where the user was before they opened it.
   *
   * Which block that is takes the same walk the delete path takes: the box
   * renders below a whole subtree, so the block above it on screen is the
   * deepest last child of what it sits under — rarely the block `after`
   * names — or of the page's last block, for the box at the end of the day.
   *
   * A page with nothing on it has no block above, and the box stays open: it
   * is the only way in, and backing out of it would leave the user looking at
   * a page they cannot type on. So does a box whose `after` the page has no
   * record of, which is the same nothing-to-go-back-to.
   */
  const cancelNew = () => {
    const blocks = page.blocks;
    const after = writing?.after;
    const found = after ? locate(blocks, after) : undefined;
    const under = after ? found?.siblings[found.at] : blocks.at(-1);
    if (!under) return;
    const above = lastLeaf(under);
    setWriting(null);
    setCaret(above.text.length);
    setEditingId(above.id);
  };

  /** The box for a block that does not exist yet. */
  const newBlockEditor = (
    <BlockEditor
      placeholder="Write something…"
      onCancel={() => setWriting(null)}
      onBackspace={cancelNew}
      onCommit={(text) => commitNew(text, { then: 'stop' })}
      onContinue={(text) => commitNew(text, { then: 'again' })}
      onIndent={(text, at, by) =>
        commitNew(text, { then: by === 1 ? 'indent' : 'outdent', caret: at })
      }
    />
  );

  /**
   * The page, depth first. Children render in their own indented column
   * under their parent, and the box for a new block sits below that whole
   * subtree — `after` makes the new block the next *sibling*, which is where
   * the fold puts it too.
   */
  const renderBlocks = (blocks: BlockType[]) =>
    blocks.map((block) => (
      <Fragment key={block.id}>
        {editingId === block.id ? (
          <BlockEditor
            initial={block.text}
            caret={caret}
            onCancel={() => setEditingId(null)}
            onCommit={(text) => commitEdit(block, text)}
            onBackspace={() => commitDelete(block)}
            onIndent={(text, at, by) => commitIndent(block, text, at, by)}
            onContinue={(text) => {
              commitEdit(block, text);
              setWriting({ after: block.id });
            }}
          />
        ) : (
          <Block
            text={block.text}
            onActivate={(at) => {
              setCaret(at);
              setEditingId(block.id);
            }}
          />
        )}
        {block.children.length > 0 && (
          <div className="block-children">{renderBlocks(block.children)}</div>
        )}
        {writing?.after === block.id && newBlockEditor}
      </Fragment>
    ));

  return (
    <>
      <h2 className="page-date">{date}</h2>

      {/* The blank space under the day is part of the day: clicking it opens
          the box at the end, the way clicking below the last line of any
          editor puts the caret there. Only when the click landed on the page
          itself — a click on a block is that block's, and it bubbles here. */}
      <div
        className="page"
        onClick={(event) => {
          if (event.target === event.currentTarget) setWriting({});
        }}
      >
        {renderBlocks(page.blocks)}

        {/* The tail: a box when one is waiting at the end of the day, and
            nothing at all otherwise — a written page ends on its last
            block, and Enter out of that block is how the next one starts.
            The exception is a page with no blocks yet, which needs
            somewhere to click or there is no way in. */}
        {writing === null ? (
          page.blocks.length === 0 && (
            <button className="block empty" onClick={() => setWriting({})}>
              Click to write the first block
            </button>
          )
        ) : writing.after === undefined ? (
          newBlockEditor
        ) : null}
      </div>
    </>
  );
}
