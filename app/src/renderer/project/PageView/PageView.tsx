import { Fragment, useContext, useEffect, useRef, useState } from 'react';
import { locate, predict, predictProperties, predictTags } from '@pbnotes/graph';
import type { Block as BlockType, Page, Property } from '@pbnotes/graph';
import type { GraphApi } from '../../../shared/graph';
import type { Act } from '../../ui';
import { Block, BlockEditor, blockBox, blockFocus } from '../Block/Block';
import LinkedReferences from './LinkedReferences/LinkedReferences';
import TaggedBy from './TaggedBy/TaggedBy';
import Properties from './Properties/Properties';
import type { Write } from './Properties/rows';
import Tags from './Tags/Tags';
import {
  add,
  addTag,
  edit,
  indent,
  outdent,
  remove,
  removeProperty,
  removeTag,
  renameProperty,
  setProperty,
} from './steps/steps';
import type { Step, StepsGraph } from './steps/steps';
import {
  afterCancel,
  afterDelete,
  afterRemove,
  movable,
  newBlock,
} from './editing/editing';
import type { Caret, Then } from './editing/editing';
import { drawn, recorded, refused, unseen } from './pending/pending';
import type { Pending } from './pending/pending';
import { Selecting } from '../selection/Selecting';
import { slot, slotKey } from '../selection/shown';
import { decode } from '../selection/clip/clip';
import { beneath, endOf, landed, withIds } from '../selection/paste/paste';
import type { Spot } from '../selection/paste/paste';

/**
 * Where an unwritten block is waiting to be typed. `after` is the block it
 * goes beneath; without one it goes at the end of the page. Null is no box
 * open at all — three states, because "writing" and "writing *here*" are
 * different questions and a boolean can only answer the first.
 */
type Writing = { after?: string } | null;

/**
 * The part of the bridge a page calls: what it calls itself, and what the
 * steps it writes through call. A cut under the page is another `PageView`,
 * so `LinkedReferences` needs no more than this.
 */
export type PageViewGraph = StepsGraph & Pick<GraphApi, 'search' | 'blockMenu' | 'carryImages'>;

type Props = {
  graph: PageViewGraph;
  /** The page as main last showed it. */
  page: Page;
  /**
   * The fold version the page was read at: what a write drawn here is
   * dropped by, once it is at or past the version that write's reply named.
   */
  version: number;
  /** What links here. Left off for a page that is itself shown as one. */
  references?: Page[];
  /**
   * The page's properties, as main last showed them. Left off where none
   * are drawn: a cut, which is another page's blocks under its heading.
   */
  properties?: Property[];
  /** The pages it points to, as main last showed them. Left off where none are drawn. */
  tags?: string[];
  /** The pages that point to it. Left off, as `references` is, where none are drawn. */
  taggedBy?: string[];
  /**
   * Shown under another page as what links to it: a cut of this page — the
   * blocks that link, not all of them — decided in main and read again
   * after every change. The title is a link to the whole page. Nothing can be
   * added here, and a block cannot be moved: the siblings that would decide
   * where it goes are not in the cut. Editing and deleting are what they are
   * anywhere, a write to the page the block is on.
   */
  reference?: boolean;
  /**
   * The block this view is zoomed into: it is shown alone, as the root, with
   * its children as the top level. One the page does not have shows the
   * whole page; the project view is what notices and says so.
   */
  zoom?: string;
  /** Moves the zoom to another block, or — with none — out to the page. */
  onZoom?: (block?: string) => void;
  /**
   * The title is a link to this page on its own: set in the journal, where
   * a day is one of many. Left off for a page already showing alone, where
   * the link would go nowhere.
   */
  linked?: boolean;
  /**
   * Which view this is, for selecting blocks (#253): the same block shows in
   * more than one, and is selected in one at a time. The page's title when
   * left off; a cut is `under` the view it is shown in.
   */
  scope?: string;
  act: Act;
};

/**
 * One page of a project — a journal day, or a page a link named; nothing
 * here can tell the two apart — its blocks, and the editing that appends to
 * them.
 *
 * The page is main's, not this one's: it arrives folded, and a write sends
 * nothing back here but the fold version it led to — main tells every window
 * the fold moved, and the page comes down again from the project view. A
 * block is on screen in more than one place — on its day, and under every
 * page it links to — and one view for all of them is what shows a write
 * everywhere it shows the block. What is held here is the editing: which box
 * is open, and where the caret is in it — and what an edit made here is about
 * to leave a block as, drawn until a view from main holds it. Nothing here is aware that there are other pages above and below
 * it, which is what keeps a stack of days the same component as a single
 * named page, and a page the same component as a cut of one.
 */
export default function PageView({
  graph,
  page: sent,
  version,
  references,
  properties: sentProperties,
  tags: sentTags,
  taggedBy,
  reference = false,
  zoom,
  onZoom,
  linked = false,
  scope: scoped,
  act,
}: Props) {
  /** The selection, which `ProjectView` holds (#253). */
  const selecting = useContext(Selecting);
  const scope = scoped ?? sent.title;
  /**
   * The writes made here that main has not answered yet, as the events they
   * will be recorded as. The page is drawn with them folded over what main
   * last sent, so a key shows what it did at once: the box that closes shows
   * the text just typed, and the block Enter wrote is there for the next box
   * to open beneath. Without them each of those waits on the disk, and shows
   * the page from before the key until it has.
   *
   * Folded with main's own reducer, and each move resolved by the function
   * main resolves it with, so what is drawn is what will be recorded. Not
   * what links to a page or what a ref quotes — those are main's to work
   * out, and arrive with its state.
   *
   * An event is dropped by version, not when its write settles (`pending/`):
   * its reply names the fold version the write led to, and a view at that
   * version or later holds it, so by then the page says the same thing. A
   * refused write is dropped at once, and the page going back to what main
   * has is the truth.
   */
  const [pending, setPending] = useState<Pending[]>([]);

  /** What a view holds is not kept: it will never be drawn again. */
  useEffect(() => {
    setPending((all) => {
      const left = unseen(all, version);
      return left.length === all.length ? all : left;
    });
  }, [version]);

  /**
   * Draws `steps` now and sends them one after another, as a key that is two
   * writes always was. If one is refused the rest are not sent, and none of
   * them that was not recorded stays drawn.
   */
  const write = async (...steps: Step[]) => {
    const events = steps.map(([event]) => event);
    setPending((all) => drawn(all, events));
    try {
      for (const [event, send] of steps) {
        const reached = await send();
        setPending((all) => recorded(all, event, reached));
      }
    } finally {
      setPending((all) => refused(all, events));
    }
  };

  /** The writes still to draw over what main last sent. */
  const inFlight = unseen(pending, version).map((it) => it.event);
  /** The page as it is drawn, which is what everything below reads. */
  const page = predict(sent, inFlight);
  /** Its properties as they are drawn, the same way. */
  const properties =
    sentProperties && predictProperties(sentProperties, sent.title, inFlight);
  /** Its tags as they are drawn, the same way. */
  const tags = sentTags && predictTags(sentTags, sent.title, inFlight);

  /**
   * Tab or Shift+Tab on a block, as the step it is on `blocks`. Undefined at
   * either edge — first among its siblings going in, already at the top level
   * coming out — where there is nowhere to go and nothing is sent.
   */
  const moving = (
    blocks: BlockType[],
    id: string,
    by: 1 | -1,
  ): Step | undefined =>
    by === 1 ? indent(graph, blocks, id) : outdent(graph, blocks, id);
  const title = page.title;
  const rooted = zoom ? locate(page.blocks, zoom) : undefined;
  const root = rooted?.siblings[rooted.at];
  /** What the root hangs under, outermost first: the breadcrumb. */
  const ancestors: BlockType[] = [];
  for (let at = rooted; at?.parent; at = locate(page.blocks, at.parent.id)) {
    ancestors.unshift(at.parent);
  }
  const [writing, setWriting] = useState<Writing>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Where the click that opened the block landed. Undefined when there was no
  // click to read a position from — keyboard activation, or a new block.
  const [caret, setCaret] = useState<number | undefined>(undefined);

  /**
   * What the page is as last drawn, for a gesture that waits on something —
   * the block menu — and has to act on the page as it is when the wait ends,
   * not as it was when it began.
   */
  const latest = useRef({ blocks: page.blocks, root, editingId, writing, onZoom });
  latest.current = { blocks: page.blocks, root, editingId, writing, onZoom };

  /** Opens the box `to` says, or closes the one open with nowhere to go. */
  const reopen = (to: Caret | null) => {
    setCaret(to?.at ?? 0);
    setEditingId(to?.editing ?? null);
  };

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
    act(() => write(edit(graph, block.id, text)));
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
    //
    // Otherwise the box goes to the block above in the order the page reads:
    // the sibling above, descended to its deepest last child, or — for a
    // first child — the block it is filed under. Only the page's very first
    // block has neither, which is why this is not simply the previous
    // sibling. Read before the delete lands, off the page still on screen.
    const next = afterDelete(page.blocks, block, { root, reference });
    if (!next) return;
    reopen(next.caret);
    // Nothing either side: the page is about to be empty. A cut has no box
    // to fall back to; emptied, it is simply not shown any more.
    if (next.openTail) setWriting({});
    // The zoomed block itself: out to what it hung under, or to the page,
    // before the delete lands and leaves the view rooted on nothing.
    if (next.unzoom) onZoom?.(next.unzoom.to);
    // Not predicted for the zoomed block: with the root gone from the page
    // as drawn, the view would show the whole page until the zoom has moved.
    act(() =>
      next.unzoom
        ? graph.run({ type: 'deleteBlock', blockId: block.id })
        : write(remove(graph, block.id)),
    );
  };

  /**
   * Right-click on a block's dot, or on a crumb above the zoomed one: its
   * menu, which main draws. Copying is main's; a delete is answered back
   * here, where what is open and where the view is are known.
   *
   * Delete Block takes the block and everything under it, which Backspace
   * never does, and without asking. Nothing opens in its place, since nothing was being typed; a box open in what
   * went closes, and a zoom into it moves out first, as Backspace's does.
   * Read off the page as it is once the menu closes: the menu can sit open
   * while the page moves.
   */
  const openMenu = (block: BlockType) =>
    act(async () => {
      // A dot among several selected deletes them all (#258). One selected
      // alone is the block alone, as is a dot outside the selection, which
      // leaves the selection as it is.
      const count = selecting.deleting(slotKey(scope, block.id));
      if (count !== undefined && count > 1) {
        // Copy Block Reference would copy one of them: not offered (#261).
        const offer = { delete: true, count, reference: false };
        if ((await graph.blockMenu(block.id, offer)) === 'delete') selecting.removeChosen();
        return;
      }
      const pick = await graph.blockMenu(block.id, { delete: true });
      if (pick !== 'delete') return;
      const now = latest.current;
      const next = afterRemove(now.blocks, block.id, {
        root: now.root,
        editing: now.editingId,
        writingAfter: now.writing?.after,
      });
      // Gone while the menu was open: nothing left to delete.
      if (!next) return;
      if (next.closeEditing) setEditingId(null);
      if (next.closeNew) setWriting(null);
      if (next.unzoom) now.onZoom?.(next.unzoom.to);
      // Not predicted when the zoom moves, for the reason `commitDelete`
      // gives.
      await (next.unzoom
        ? graph.run({ type: 'deleteBlock', blockId: block.id })
        : write(remove(graph, block.id)));
    });

  /**
   * Tab and Shift+Tab. Files the block under the sibling above it, or brings
   * it back out beneath what it was filed under — children and all, either
   * way — and leaves the user still writing in it.
   *
   * The block is drawn where it is going at once, and the box goes with it.
   * It lands somewhere else in the rendered tree, so that is a new box in the
   * new place rather than this one moved — opened on the text as typed, with
   * the caret where it was. The old one is unmounted by the same render, and
   * a box React takes away does not blur, so nothing is committed twice.
   *
   * At either edge — first among its siblings going in, already at the top
   * level coming out — there is nowhere to go, so the keystroke does nothing
   * and nothing is sent.
   */
  const commitIndent = (
    block: BlockType,
    text: string,
    at: number,
    by: 1 | -1,
  ) => {
    // Zoomed, the root's children are the top level, and the root itself has
    // no siblings in view to move among: either move would take a block out
    // of the view it is being written in.
    if (!movable(page.blocks, block.id, by, root)) return;
    const moved = moving(page.blocks, block.id, by);
    if (!moved) return;
    // The block is drawn where it is going in the render this key causes, so
    // the box moves with it: a new box in the new place, on the text as typed
    // and the caret where it was. Tab is not a commit, but the text has to be
    // written for that — unchanged, it appends nothing, as ever.
    setCaret(at);
    act(() =>
      write(
        ...(text === block.text ? [] : [edit(graph, block.id, text)]),
        moved,
      ),
    );
  };

  /**
   * Writes the box that is open, and then either stops, opens another beneath
   * what it just wrote — which is what makes a run of blocks typeable without
   * reaching for the mouse between them — or indents what it wrote. All of
   * it at once: the block is named here and drawn before main has written
   * it, so the next box is open for the very next key.
   *
   * `indent` is Tab in a box for a block that does not exist yet, which is
   * the ordinary way an outline gets built: type, Enter, Tab. It takes two
   * events, because nothing can be filed under a block that was never
   * written. The user pressed one key, so the box reopens on what they were
   * typing in rather than closing.
   *
   * Hands back the block it wrote, if it wrote one.
   */
  const commitNew = (
    text: string,
    { then, caret }: { then: Then; caret?: number },
  ): string | undefined => {
    // Zoomed, the end of the view is the end of the root's children, not of
    // the page. A root with none yet takes two events, like Tab in a new box:
    // the block is written beside the root and then filed under it.
    //
    // Enter on an empty box that is sitting among a block's children pops the
    // box out a level rather than writing anything. It looks like an outdent
    // and it is not one: nothing has been written, so there is no block to
    // move — the box just re-places itself beside the parent, which is where
    // a block typed there would have gone anyway. Repeats all the way out, a
    // level per press, because each one leaves the box beside its new parent
    // and asks the same question again. At the top level there is no parent
    // left and Enter goes back to making a gap. Not past the root, though:
    // zoomed, its children are the top level.
    //
    // An empty block is written when it is *asked* for — Enter on an empty
    // box is how a gap gets made, and so is Tab. Blurring a box nothing was
    // ever typed into is a click that landed elsewhere, and writes nothing.
    const plan = newBlock(page.blocks, {
      root,
      after: writing?.after,
      text,
      then,
    });
    setWriting(null);
    if (plan.kind === 'pop') {
      setWriting({ after: plan.after });
      return undefined;
    }
    if (plan.kind === 'nothing') return undefined;

    // Named here, so the block is drawn — and the next box opened beneath
    // it, or this one reopened on it — before main has heard of it.
    const id = crypto.randomUUID();
    const create = add(graph, id, title, text, plan.after);
    const steps: Step[] = [create];
    // Each move resolved on the page as the steps before it leave it. One
    // with nowhere to go — the first block of an empty page going in, a
    // top-level one coming out — is not a step at all.
    let next = predict(page, [create[0]]);
    const move = (by: 1 | -1) => {
      const moved = moving(next.blocks, id, by);
      if (!moved) return;
      steps.push(moved);
      next = predict(next, [moved[0]]);
    };
    if (plan.indent) move(1);
    if (then === 'again') setWriting({ after: id });
    // Out of the top level of a zoom is out of the view: the box reopens
    // where it was, like any move with nowhere to go.
    if (plan.move) move(plan.move);
    if (then === 'indent' || then === 'outdent') {
      setCaret(caret);
      setEditingId(id);
    }
    act(() => write(...steps));
    return id;
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
   * names — or of the page's last block, for the box at the end of the page.
   *
   * A page with nothing on it has no block above, and the box stays open: it
   * is the only way in, and backing out of it would leave the user looking at
   * a page they cannot type on. So does a box whose `after` the page has no
   * record of, which is the same nothing-to-go-back-to.
   */
  const cancelNew = () => {
    const above = afterCancel(page.blocks, writing?.after, root);
    if (!above) return;
    setWriting(null);
    reopen(above);
  };

  /**
   * Blocks from a pbnotes copy, pasted into a box (#261). Into an empty one,
   * the first block takes its place: the block the box is open on keeps its
   * id and takes the first block's text, and a new box's place is where the
   * paste starts. With something typed, that is written first, as blur
   * writes it, and the paste goes beneath it at its depth. The box closes.
   * Written once the images it links are in this project, and not drawn
   * ahead of main. Anything else on the clipboard is the box's.
   */
  const pasteIn = (data: DataTransfer, text: string, block?: BlockType): boolean => {
    const html = data.getData('text/html');
    const clipped = decode(html);
    if (!clipped) return false;
    let spot: Spot;
    if (block) {
      setEditingId(null);
      if (text === '') {
        spot = { into: block.id };
      } else {
        if (text !== block.text) act(() => write(edit(graph, block.id, text)));
        spot = beneath(block.id, root);
      }
    } else {
      const written = text === '' ? undefined : commitNew(text, { then: 'stop' });
      setWriting(null);
      spot = written ? { after: written } : writing?.after ? { after: writing.after } : endOf(root);
    }
    act(async () => {
      const pasting = withIds(await landed(graph, clipped, html), () => crypto.randomUUID());
      await graph.run({ type: 'pasteBlocks', title, blocks: pasting, ...spot });
    });
    return true;
  };

  /**
   * A row of the properties table left with something to write: drawn at
   * once, and sent in order. A rename is one batch; a value changed in the
   * same edit is written after it, over the value it kept.
   */
  const commitProperties = (writes: Write[]) => {
    const steps = writes.map((it) =>
      it.kind === 'set'
        ? setProperty(graph, title, it.key, it.value)
        : renameProperty(graph, title, it.from, it.to, it.value),
    );
    act(() => write(...steps));
  };

  /** The × on a row. */
  const removeRow = (key: string) => act(() => write(removeProperty(graph, title, key)));

  /** Titles alone, for the tag and key inputs: a tag or a key is the name picked. */
  const findTitles = (query: string) =>
    graph.search(query).then((found) => found.map(({ title }) => title));

  /** A tag typed or picked in the chip row, and the × on a chip. */
  const tagPage = (tag: string) => act(() => write(addTag(graph, title, tag)));
  const untagPage = (tag: string) => act(() => write(removeTag(graph, title, tag)));

  /** The box for a block that does not exist yet. */
  const newBlockEditor = (
    <BlockEditor
      placeholder="Write something…"
      findPages={graph.search}
      onCancel={() => setWriting(null)}
      onBackspace={cancelNew}
      onCommit={(text) => commitNew(text, { then: 'stop' })}
      onContinue={(text) => commitNew(text, { then: 'again' })}
      onPaste={(data, text) => pasteIn(data, text)}
      onIndent={(text, at, by) =>
        commitNew(text, { then: by === 1 ? 'indent' : 'outdent', caret: at })
      }
      // Written as blur would write it, and then what was written is
      // selected. Before it is drawn it is not in the order on screen yet,
      // so it is selected alone, whichever key it was.
      onSelect={(text) => {
        const id = commitNew(text, { then: 'stop' });
        if (id) selecting.fromBox(slotKey(scope, id), 'here');
      }}
      mac={selecting.mac}
    />
  );

  /**
   * Enter on a selection opens the box of the first block in it, caret at
   * the end, when that block is in this view.
   */
  const opening = selecting.opening;
  useEffect(() => {
    if (opening?.scope !== scope) return;
    setWriting(null);
    setCaret(Number.MAX_SAFE_INTEGER);
    setEditingId(opening.id);
    selecting.onOpened();
  }, [opening]);

  /**
   * The page, depth first. Children render in their own indented column
   * under their parent, and the box for a new block sits below that whole
   * subtree — `after` makes the new block the next *sibling*, which is where
   * the fold puts it too.
   *
   * In a cut, Enter ends the block and opens nothing after it, and Tab is
   * the focus key it is everywhere else: there is nowhere to add, and
   * nothing here to move a block under.
   */
  const renderBlock = (block: BlockType, parent: string | undefined, lit: boolean) => {
    const data = slot(scope, title, block.id, parent);
    return editingId === block.id ? (
      <BlockEditor
        initial={block.text}
        caret={caret}
        findPages={graph.search}
        data={data}
        mac={selecting.mac}
        onCancel={() => setEditingId(null)}
        onSelect={(text, how) => {
          commitEdit(block, text);
          selecting.fromBox(data['data-slot'], how);
        }}
        onCommit={(text) => commitEdit(block, text)}
        onBackspace={() => commitDelete(block)}
        onPaste={(data, text) => pasteIn(data, text, block)}
        onIndent={
          reference
            ? undefined
            : (text, at, by) => commitIndent(block, text, at, by)
        }
        onContinue={(text) => {
          commitEdit(block, text);
          // Out of the zoomed block, the next one goes under it: beside
          // it would be a sibling nobody can see.
          if (!reference) {
            setWriting(block.id === root?.id ? {} : { after: block.id });
          }
        }}
      />
    ) : (
      <Block
        id={block.id}
        text={block.text}
        data={data}
        selected={lit}
        onActivate={(at) => {
          setCaret(at);
          setEditingId(block.id);
        }}
        onMenu={() => openMenu(block)}
      />
    );
  };

  /**
   * `parent` is the block they show under, if any. `lit` is whether that is
   * selected: a block brings its subtree, so everything under a selected one
   * is drawn selected too.
   */
  const renderBlocks = (blocks: BlockType[], parent?: string, lit = false) =>
    blocks.map((block) => {
      const on = lit || selecting.selected.has(slotKey(scope, block.id));
      return (
        <Fragment key={block.id}>
          {renderBlock(block, parent, on)}
          {block.children.length > 0 && (
            // Its own column, since the gap between blocks does not inherit.
            <div className="ml-indent flex flex-col gap-1">
              {renderBlocks(block.children, block.id, on)}
            </div>
          )}
          {writing?.after === block.id && newBlockEditor}
        </Fragment>
      );
    });

  /**
   * The tail of a day is click-to-write, so it needs somewhere to click and a
   * caret to say so, and the room doubles as the air before the next day —
   * less of it when what follows is the page's own references. A cut sits in
   * under its heading like children under a parent, and its blank space is
   * not click-to-write, so no caret and no room kept.
   */
  /** Whether the zoomed block is selected, and with it everything shown. */
  const rootLit = root !== undefined && selecting.selected.has(slotKey(scope, root.id));

  const pageSpace = reference
    ? 'ml-indent cursor-default'
    : references?.length || taggedBy?.length
      ? 'cursor-text pb-5'
      : 'cursor-text pb-12';

  return (
    <>
      {/* The header: the title, and on a page's own view its tags and
          properties. What is marked `data-reveal` in it ("+ Add tag", "+ Add
          property") shows only while it is hovered or holds focus, so a new
          page is not two empty placeholders under its title. Hidden is
          opacity, not removal: they keep their room, and nothing below moves
          as the pointer crosses the title. */}
      <div className="[&_[data-reveal]]:opacity-0 [&_[data-reveal]]:transition-opacity focus-within:[&_[data-reveal]]:opacity-100 hover:[&_[data-reveal]]:opacity-100">
        {/* A cut is headed by the page it is cut from, as a link there — the
            project view follows it like the ones in the blocks. */}
        {reference ? (
          <h4 className="mt-3 mb-1 text-sm font-semibold">
            <a className="wikilink text-accent" href={`#${title}`}>
              {title}
            </a>
          </h4>
        ) : root ? (
          /* Zoomed: the title steps back to a link out to the whole page, and
             what the block hangs under follows it, each a way out to that
             level. The project view follows both — the title as the wikilink
             it is, a crumb by its `data-block-ref`, like a dot.
             ponytail: a crumb is the first line of its block as written,
             Markdown and all. Render it once a `**` in one looks wrong. */
          <nav className="mt-6 mb-4 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
            <a className="wikilink text-accent" href={`#${title}`}>
              {title}
            </a>
            {ancestors.map((ancestor) => (
              <Fragment key={ancestor.id}>
                <span aria-hidden>›</span>
                <a
                  href="#"
                  data-block-ref={ancestor.id}
                  className="max-w-48 truncate hover:text-accent"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(ancestor);
                  }}
                >
                  {ancestor.text.split('\n')[0] || '…'}
                </a>
              </Fragment>
            ))}
          </nav>
        ) : (
          <h2 className="mt-6 mb-4 text-2xl font-semibold">
            {/* A heading still, not a link in the text: no accent, and only
                the underline on hover says it goes somewhere. The project
                view follows it like any wikilink. */}
            {linked ? (
              <a className="wikilink hover:underline" href={`#${title}`}>
                {title}
              </a>
            ) : (
              title
            )}
          </h2>
        )}

        {/* Under the title, above the properties, on the same terms: a journal
            day shows its tags only when it has some, and neither a zoom nor a
            cut shows them. */}
        {tags && !reference && !root && (!linked || tags.length > 0) && (
          <Tags tags={tags} findTags={findTitles} onAdd={tagPage} onRemove={untagPage} />
        )}

        {/* Under the title, on the page's own view. A journal day shows its
            table only when it has something in it: an empty one on every day
            is noise, and the first property on a day is added from its page.
            Not under a zoom, where what shows is a block and the page's
            properties would read as its own. */}
        {properties && !reference && !root && (!linked || properties.length > 0) && (
          <Properties
            rows={properties}
            findKeys={findTitles}
            onCommit={commitProperties}
            onRemove={removeRow}
          />
        )}
      </div>

      {/* The blank space under the page is part of the page: clicking it opens
          the box at the end, the way clicking below the last line of any
          editor puts the caret there. Only when the click landed on the page
          itself — a click on a block is that block's, and it bubbles here.
          Not in a cut, which has no end to write at. */}
      <div
        className={`flex flex-col gap-1 ${pageSpace}`}
        onClick={(event) => {
          if (!reference && event.target === event.currentTarget) {
            setWriting({});
          }
        }}
      >
        {root ? (
          // Keyed, or zooming out with a box open hands the new root the old
          // root's box — and its text, which blur would then commit over it.
          <Fragment key={root.id}>
            {renderBlock(root, undefined, rootLit)}
            {renderBlocks(root.children, root.id, rootLit)}
          </Fragment>
        ) : (
          renderBlocks(page.blocks)
        )}

        {/* The tail: a box when one is waiting at the end of the page, and
            nothing at all otherwise — a written page ends on its last
            block, and Enter out of that block is how the next one starts.
            The exception is a page with no blocks yet, which needs
            somewhere to click or there is no way in. A cut has no tail: it
            is never empty, because an empty cut is not shown, and nothing
            is added to it. */}
        {reference ? null : writing === null ? (
          page.blocks.length === 0 && (
            <button
              className={`${blockBox} ${blockFocus} cursor-text text-muted`}
              onClick={() => setWriting({})}>
              Click to write the first block
            </button>
          )
        ) : writing.after === undefined ? (
          newBlockEditor
        ) : null}
      </div>

      {/* After the page, not in it: the blank space in the page is
          click-to-write, and these are other graph' blocks. */}
      {/* Above what links here: a tag is a deliberate statement about the
          whole page, a link a passing mention in a block. The air after it is
          the page's own when nothing links here, and less when something
          does. */}
      {taggedBy && taggedBy.length > 0 && !reference && !root && (
        <div className={references?.length ? 'pb-5' : 'pb-12'}>
          <TaggedBy tag={title} pages={taggedBy} />
        </div>
      )}

      {references && (
        <LinkedReferences
          graph={graph}
          references={references}
          version={version}
          scope={scope}
          act={act}
        />
      )}
    </>
  );
}
