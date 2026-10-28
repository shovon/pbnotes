import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { locate, pageKey, today } from '@pbnotes/pages';
import type { PagesApi, PagesState } from '../../shared/pages';
import type { Act } from '../ui';
import { Previews } from './Block/Block';
import PageView from './PageView/PageView';
import type { PageViewPages } from './PageView/PageView';
import { imageTarget, placeNew } from './placement/placement';

/**
 * The part of the bridge a project calls: what it calls itself, and what each
 * page it shows does.
 */
export type ProjectViewPages = PageViewPages &
  Pick<
    PagesApi,
    | 'onChanged'
    | 'show'
    | 'locate'
    | 'go'
    | 'back'
    | 'rezoom'
    | 'addImage'
    | 'addBlock'
    | 'indentBlock'
    | 'blockMenu'
  >;

/**
 * A project, in one of two shapes. By default the journal: every day that has
 * anything on it, newest first, with today at the top. Follow a link and it
 * is that one page instead, with a way back to the journal above it.
 *
 * All of that is main's: which page is showing, the trail that led there,
 * the pages themselves and what links to them. This view draws the state main
 * last sent and asks for the next one — a write, a link followed, a step
 * back — and nothing here keeps a copy to hold in step. What is its own is
 * what lasts only as long as a gesture: the block to scroll to, and where a
 * pasted image goes.
 *
 * ponytail: the whole history renders at once. Add windowing when someone has
 * enough years in one project for that to show.
 */
/** The image files in a paste or a drop. */
const images = (data: DataTransfer): File[] =>
  [...data.files].filter((file) => file.type.startsWith('image/'));

type Props = {
  act: Act;
  /** The bridge to main, handed down from `index.tsx`, and on to each page. */
  pages: ProjectViewPages;
  /** The clock, for which day a drop with no page lands on. */
  now: () => Date;
};

export default function ProjectView({ act, pages, now }: Props) {
  /** What main has in mind, as it last said. Null until it first has. */
  const [state, setState] = useState<PagesState | null>(null);
  const trail = state?.trail ?? [];
  const title = trail.at(-1)?.page ?? null;
  /** The block the view is zoomed into, when it is. */
  const zoom = trail.at(-1)?.block;

  /**
   * Listening before asking, so the answer has somewhere to land. Everything
   * after it arrives the same way: this window's writes, a step along the
   * trail, and another machine's notes folded in. A project that cannot be
   * reached rejects the ask, and that is the one notice the view needs.
   */
  useEffect(() => {
    const off = pages.onChanged(setState);
    act(() => pages.show());
    // A stubbed bridge — Storybook's — answers with something that is not an
    // unsubscribe, and a cleanup that is not a function throws.
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  const previews = useMemo(() => new Map(state?.previews), [state?.previews]);

  /**
   * Read after the first commit rather than during render: on the very first
   * one the header has not been put in the DOM yet.
   */
  const [titlebar, setTitlebar] = useState<Element | null>(null);
  useEffect(() => setTitlebar(document.getElementById('titlebar')), []);

  /**
   * To the top on navigation only. A day rolling over mid-session, or another
   * device's notes landing, re-reads the page under someone who is reading it;
   * moving them to the top of it would be a second surprise on top of the
   * first.
   *
   * Above the scroll to a block, and it has to stay there: when the two land
   * in one render, effects run in this order and the block has the last word.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [title, zoom]);

  /** A block to scroll to and flash once its page has rendered. */
  const [target, setTarget] = useState<string | null>(null);

  /**
   * Opens the page a block is on, the way a wikilink does, and brings the
   * block into view. A block that is gone lands in the app's notice rather
   * than a click that did nothing.
   */
  const goToBlock = (id: string) =>
    act(async () => {
      const found = await pages.locate(id);
      if (!found) throw new Error('That block no longer exists.');
      await pages.go({ page: found.page });
      setTarget(id);
    });

  /**
   * Makes a block the root of the view: what its dot does. Asked of main like
   * `goToBlock`, because a dot in a cut belongs to a page that is not the one
   * showing.
   */
  const zoomTo = (id: string) =>
    act(async () => {
      const found = await pages.locate(id);
      if (!found) throw new Error('That block no longer exists.');
      await pages.go({ page: found.page, block: id });
    });

  /**
   * After the page is drawn, not on `go`: the state is here by the time `go`
   * resolves, but the block is not in the DOM until it has rendered. Cleared
   * either way, so a block that is open in an editor — which carries no hook
   * — is not scrolled to on some later render.
   */
  useEffect(() => {
    if (target === null || state === null) return;
    setTarget(null);
    const element = document.querySelector(
      `[data-block-id="${CSS.escape(target)}"]`,
    );
    if (!element) return;
    element.scrollIntoView({ block: 'center' });
    element.animate(
      [
        {
          backgroundColor:
            'color-mix(in srgb, var(--color-accent) 25%, transparent)',
        },
        { backgroundColor: 'transparent' },
      ],
      { duration: 1500, easing: 'ease-out' },
    );
  }, [target, state]);

  /**
   * The zoomed block is not on its page: another device deleted it, or back
   * came round to one deleted since. The page it was on is the nearest thing
   * left, with a notice so the view did not just change by itself. A delete
   * made here never gets this far — the page zooms out before it writes.
   */
  const zoomed = zoom ? state?.showing[0]?.page : undefined;
  useEffect(() => {
    if (!zoom || !zoomed || locate(zoomed.blocks, zoom)) return;
    act(async () => {
      await pages.rezoom();
      throw new Error('That block no longer exists.');
    });
  }, [zoom, zoomed]);

  /**
   * Every wikilink in every block lands here, in the capture phase, before
   * the block it sits in can turn the click into an edit. Stopping it there
   * is what keeps the editor closed: React's bubbling `onClick` on the block
   * never runs. The page is read off the attribute, not `href` — that one
   * comes back absolute and percent-encoded.
   */
  const follow = (event: React.MouseEvent) => {
    // A block ref, by the id it carries: a dot, or a rendered `((id))`.
    // A rendered ref goes to the block where it sits; a dot, or a crumb
    // above a zoomed block, zooms into it.
    const mark = (event.target as Element).closest('[data-block-ref]');
    const ref = mark?.getAttribute('data-block-ref');
    if (mark && ref) {
      event.preventDefault();
      event.stopPropagation();
      if (mark.matches('.block-ref')) goToBlock(ref);
      else zoomTo(ref);
      return;
    }
    const link = (event.target as Element).closest('a.wikilink[href]');
    const page = link?.getAttribute('href')?.slice(1);
    if (!page) return;
    event.preventDefault();
    // A link to the page already open goes nowhere, so there is no
    // navigation here to keep the editor closed for: let the click through
    // to the block, which opens it. Every block listed under a page holds
    // one of these by construction, so in a cut it is the common case —
    // swallowed, the most obvious thing on screen to click did nothing.
    // Zoomed in, the same link is the way out to the whole page.
    if (title !== null && pageKey(page) === pageKey(title) && !zoom) return;
    event.stopPropagation();
    act(() => pages.go({ page }));
  };

  const wrapper = useRef<HTMLDivElement>(null);

  /**
   * Puts pasted or dropped images into the notes: each is stored in the
   * project's folder, and its link goes in one of two places.
   *
   * With a block open, at the end of that block as a paragraph of its own —
   * not at the caret, which can be in the middle of a sentence or a code
   * block, and the end is the same place every time. Written into the box
   * like typing: it is committed, or discarded, with the rest of the box.
   *
   * With none open, or one that closed while the file was being stored, as a
   * new block last on the page: the page dropped on, else the one showing,
   * else today. Zoomed, last under the zoomed block, as a box at the end of
   * that view writes — the end of the page would be out of sight.
   */
  const placeImages = (files: File[], dropped?: string) => {
    const active = document.activeElement;
    const box =
      active instanceof HTMLTextAreaElement && wrapper.current?.contains(active)
        ? active
        : null;
    const { page: to, root } = imageTarget({
      dropped,
      title,
      today: today(now()),
      showing: state?.showing.map((it) => it.page) ?? [],
      zoom,
    });
    // The last one written, so a second lands beneath the first.
    let last: string | undefined;
    act(async () => {
      for (const file of files) {
        const link = await pages.addImage(
          new Uint8Array(await file.arrayBuffer()),
          file.type,
        );
        const text = `![](${link})`;
        if (box?.isConnected) {
          box.value = [box.value.trimEnd(), text].filter(Boolean).join('\n\n');
          continue;
        }
        // The first under a root with no children: written beside it, then
        // filed under it, like the box at the end of a zoom in `PageView`.
        const { after, indent } = placeNew(root, last);
        const id = crypto.randomUUID();
        await pages.addBlock(id, to, text, after);
        last = id;
        if (indent) await pages.indentBlock(id);
      }
    });
  };

  /**
   * On the document, not the view: with no box open the paste has nothing
   * focused to land on, and arrives at the body. Subscribed again each
   * render, so it places by the state as it is now.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      // Text copied out of a word processor comes with a picture of itself.
      // That is a paste of text.
      if (!data || ['text/plain', 'text/html'].every((it) => data.types.includes(it))) {
        return;
      }
      const files = images(data);
      if (files.length === 0) return;
      event.preventDefault();
      placeImages(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const onDrop = (event: React.DragEvent) => {
    const files = images(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    placeImages(
      files,
      (event.target as Element).closest<HTMLElement>('[data-page]')?.dataset.page,
    );
  };

  /**
   * Right-click on a dot opens its menu instead of the browser's. Anywhere
   * else is left alone, so text keeps its cut/copy/paste. A right-click never
   * fires `click`, so `follow` stays out of it on its own.
   */
  const blockMenu = (event: React.MouseEvent) => {
    const ref = (event.target as Element)
      .closest('[data-block-ref]')
      ?.getAttribute('data-block-ref');
    if (!ref) return;
    event.preventDefault();
    void pages.blockMenu(ref);
  };

  return (
    <div
      ref={wrapper}
      onClickCapture={follow}
      onContextMenuCapture={blockMenu}
      // A drop is only offered where `dragover` was refused its default.
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      {/* The way back belongs with the window's own controls, beside the
          project picker, not on the page it is a way back from — it is about
          where you are, like the picker is, and the page below it is just
          what is there at the moment. `App` owns that strip, and this view
          owns the state the button acts on, so the button goes up there
          through a portal: still this view's, rendered in App's corner. */}
      {titlebar !== null &&
        title !== null &&
        createPortal(
          // Borderless until pointed at, like the picker beside it. Capped,
          // because it names the page it goes back to, and a page is named
          // whatever a link said — long enough to shove the picker out.
          <button
            className="app-region-no-drag ml-1 max-w-56 cursor-pointer truncate rounded-md border border-transparent px-1.5 py-0.5 text-sm hover:border-accent hover:text-accent"
            onClick={() => act(() => pages.back())}
          >
            ← {trail.at(-2)?.page ?? 'Journal'}
          </button>,
          titlebar,
        )}

      <Previews value={previews}>
        {state === null ? (
          <p className="mt-1 text-sm text-muted">Loading…</p>
        ) : (
          state.showing.map(({ page, references }) => (
            // Keyed by the title, so a page is never handed another page's
            // editor state — the open box and the block id in it belong to
            // the page they were opened on. The element is only a name on
            // everything the page shows, for a drop to read; it has no box.
            <div key={page.title} data-page={page.title} className="contents">
              <PageView
                pages={pages}
                page={page}
                // Not under a zoom: what links to one block is #2's.
                references={zoom ? undefined : references}
                zoom={zoom}
                onZoom={(block) => act(() => pages.rezoom(block))}
                // No title is the journal: each day heads one of many.
                linked={title === null}
                act={act}
              />
            </div>
          ))
        )}
      </Previews>
    </div>
  );
}
