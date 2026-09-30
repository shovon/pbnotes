import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Availability, Project } from '../../shared/projects';
import { locate } from '../../shared/pages';
import type { Page } from '../../shared/pages';
import { today } from '../ui';
import type { Act } from '../ui';
import PageView from './PageView/PageView';

const { pages } = window.gnotes;

type Props = {
  project: Project;
  availability: Availability;
  act: Act;
};

/**
 * A project, in one of two shapes. By default the journal: every day that has
 * anything on it, newest first, with today at the top. Follow a link and it
 * is that one page instead, with a way back to the journal above it.
 *
 * Which page is showing is ordinary state, for the reason `App` gives about
 * which project is showing: there is no address bar, so there is no URL for
 * a router to own — and no history stack either, so `trail` is it.
 *
 * The journal comes in one read. A project's pages are folded out of a single
 * log whether the view asks for one of them or all of them, so there is
 * nothing to save by asking for less — and a day is only ever a heading and a
 * handful of lines. From there on, writes hand the folded page straight back,
 * and it is kept here over the stack as read: nothing re-reads the whole
 * stack to add a block, and a block edited under one page — as something
 * that links to it — changes on its own page too, further up the same
 * screen.
 *
 * ponytail: the whole history renders at once. Add windowing when someone has
 * enough years in one project for that to show.
 */
export default function ProjectView({ project, act: outer }: Props) {
  // ponytail: read once per render, so a window left open across midnight
  // keeps yesterday at the top until something re-renders it. Add a timer to
  // the next local midnight if that ever bites.
  const date = today();
  /**
   * Where you are, kept as the trail that got you there rather than one
   * title: the journal is an empty trail, and every link followed is one
   * more on the end. Back takes the last one off, so A → B → C comes back
   * through B instead of skipping the middle of its own history.
   */
  const [trail, setTrail] = useState<string[]>([]);
  const title = trail.at(-1) ?? null;
  const [stack, setStack] = useState<Page[] | null>(null);
  /**
   * Title → the page as the last write to it handed it back, over the stack
   * as read. A `Map`, like `references`, because a title is whatever a link
   * said — a page called `constructor` is a page — and a plain object would
   * find a prototype's property by that name before it found nothing.
   */
  const [latest, setLatest] = useState(new Map<string, Page>());
  /** Title → what links to it, for every page in the stack. */
  const [references, setReferences] = useState(new Map<string, Page[]>());
  /** Counts the writes, so the references can be read again after each. */
  const [written, setWritten] = useState(0);
  const writes = useRef(0);
  /**
   * Counts what has arrived from another device, so the page can be read
   * again. Separate from `written`: a write already holds the page it
   * produced, and an arrival is the case where nothing on screen came from
   * what changed.
   */
  const [arrived, setArrived] = useState(0);

  /**
   * A write on one page changes what links to another — today's new block
   * names a day further down the stack — so every write has the references
   * of the whole stack read again once it has settled. Settled, not
   * succeeded: an indent is two writes, and the first can land when the
   * second does not.
   */
  const act: Act = (action) =>
    outer(() =>
      action().finally(() => {
        writes.current += 1;
        setWritten(writes.current);
      }),
    );

  /** A page a write handed back, kept over the one that was read. */
  const onPage = (next: Page) =>
    setLatest((all) => new Map(all).set(next.title, next));

  /**
   * A cut, with every block in it as the page it was cut from has it now.
   *
   * A cut is read from main and then stands still, but the blocks in it
   * belong to a page that is on this same screen and can be written to —
   * from the cut itself, or from the page above. Left as read, the two
   * copies of one block disagree from the moment of a write until the next
   * read lands: the cut goes on showing the text from before it, and a box
   * opened there would commit that text back over the edit that just
   * happened.
   *
   * So a cut is re-cut from what its page holds now — the same blocks by
   * id, each as the last write left it, and nothing at all for one that was
   * deleted. Which blocks belong in it is still main's answer: a block that
   * has only just come to link here appears when the re-read lands.
   */
  const recut = (cut: Page): Page => {
    const source = latest.get(cut.title);
    if (!source) return cut;
    return {
      ...cut,
      blocks: cut.blocks.flatMap((block) => {
        const found = locate(source.blocks, block.id);
        return found ? [found.siblings[found.at]] : [];
      }),
    };
  };

  /** What links to `title`, as those pages stand now. A cut every block of
      which has since gone is not shown at all. */
  const cuts = (title: string): Page[] =>
    (references.get(title) ?? [])
      .map(recut)
      .filter((cut) => cut.blocks.length > 0);

  /**
   * Read after the first commit rather than during render: on the very first
   * one the header has not been put in the DOM yet.
   */
  const [titlebar, setTitlebar] = useState<Element | null>(null);
  useEffect(() => setTitlebar(document.getElementById('titlebar')), []);

  /**
   * The two updates in one event, so they land in one render: the stack is
   * gone in the very render that changes the title. Clearing it from the
   * effect instead is too late — that render has already mounted a `PageView`
   * for the new title on the *old* stack (an empty today, say), and a
   * `PageView` holds its editing state from mount. The effect's clear is then
   * batched with the read that follows a millisecond later, "Loading…" never
   * commits, and the stale instance keeps its editing state under the same
   * key.
   *
   * A link to the page already showing — every block listed under a page as
   * a reference to it holds one — is nothing to do, and must not clear the
   * stack: nothing the read depends on would change, so nothing would read
   * it back.
   */
  const go = (next: string | null) => {
    if (next === title) return;
    setTrail((was) => (next === null ? [] : [...was, next]));
    setStack(null);
  };

  /** One step back along the trail; from the first page that is the journal. */
  const back = () => {
    setTrail((was) => was.slice(0, -1));
    setStack(null);
  };

  /** A block to scroll to and flash once its page has rendered. */
  const [target, setTarget] = useState<string | null>(null);

  /**
   * Opens the page a block is on, the way a wikilink does, and brings the
   * block into view. Through `outer`, not `act`: a lookup writes nothing, so
   * there are no references to read again — but a block that is gone still
   * lands in the app's notice rather than a click that did nothing.
   */
  const goToBlock = (id: string) =>
    outer(async () => {
      const found = await pages.locate(project.id, id);
      if (!found) throw new Error('That block no longer exists.');
      go(found.page);
      setTarget(id);
    });

  /**
   * After the page lands, not on `go`: the block is not in the DOM until the
   * read behind it is. Cleared either way, so a block that is open in an
   * editor — which carries no hook — is not scrolled to on some later render.
   */
  useEffect(() => {
    if (target === null || stack === null) return;
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
  }, [target, stack]);

  /**
   * Another machine wrote in this project's folder and main has folded it in.
   * Nothing local caused it, so nothing local would have read it back.
   */
  useEffect(() => {
    const off = pages.onChanged((id) => {
      if (id === project.id) setArrived((seen) => seen + 1);
    });
    // A stubbed bridge — Storybook's — answers with something that is not an
    // unsubscribe, and a cleanup that is not a function throws.
    return () => {
      if (typeof off === 'function') off();
    };
  }, [project.id]);

  /**
   * To the top on navigation only. A day rolling over mid-session, or another
   * device's notes landing, re-reads the page under someone who is reading it;
   * moving them to the top of it would be a second surprise on top of the
   * first.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [project.id, title]);

  useEffect(() => {
    let current = true;
    const read =
      title === null
        ? pages.openAll(project.id)
        : pages.open(project.id, title).then((page) => [page]);
    // A rejected read must not strand the view on "Loading…". The only title
    // main refuses is one the link plugin never produces, so there is nothing
    // to tell the user beyond an empty page.
    void read
      .catch((): Page[] => [])
      .then((next) => {
        if (!current) return;
        setStack(next);
        // Newer than anything a write handed back before it.
        setLatest(new Map());
      });
    // Dropped if the view moves to another project or page, or the day rolls
    // over mid-session, so a slow read cannot paint the wrong thing.
    return () => {
      current = false;
    };
  }, [project.id, date, title, arrived]);

  /**
   * Today is in the journal whether or not it has been written on: it is the
   * day the user is about to type in, and main leaves it out until it has
   * blocks because it has no opinion about which day today is. A single page
   * is left exactly as it was read.
   *
   * Sorted again only in that case, and only because a day dated later than
   * today can exist — another machine with a fast clock, or a folder that
   * travelled backwards across a date line. Rare, and not worth rendering out
   * of order over.
   */
  const shown =
    stack === null || title !== null || stack.some((page) => page.title === date)
      ? stack
      : [{ title: date, blocks: [] }, ...stack].sort((a, b) =>
          b.title.localeCompare(a.title),
        );

  /**
   * One read per page shown, after the stack is in and after every write.
   * The stack paints first and the references land a beat behind it — two
   * local calls apart, not something to hold the page for. An empty today is
   * asked about too: other days can name it.
   *
   * On `stack` rather than `shown`: when today is prepended, `shown` is a
   * fresh array every render, and the effect would re-run after its own
   * `setReferences`. A read that lands after a later write has been counted
   * is dropped — the read that write started is the one to show.
   */
  useEffect(() => {
    if (!shown) return;
    let current = true;
    const at = writes.current;
    void Promise.all(
      shown.map(async (page): Promise<[string, Page[]]> => [
        page.title,
        await pages.references(project.id, page.title),
      ]),
    )
      .then((entries) => {
        if (current && writes.current === at) setReferences(new Map(entries));
      })
      // Swallowed, like the stack read above: a project that cannot be
      // reached fails both, and neither has anywhere to say so — there is
      // no notice on this view, and one raised per page in a journal would
      // be a stack of them for a single unplugged drive.
      // ponytail: the whole view is silent about an unreachable log. Give
      // it one notice, from the stack read, and this can point at it.
      .catch((): void => undefined);
    return () => {
      current = false;
    };
  }, [project.id, stack, written]);

  /**
   * Every wikilink in every block lands here, in the capture phase, before
   * the block it sits in can turn the click into an edit. Stopping it there
   * is what keeps the editor closed: React's bubbling `onClick` on the block
   * never runs. The page is read off the attribute, not `href` — that one
   * comes back absolute and percent-encoded.
   */
  const follow = (event: React.MouseEvent) => {
    // A block ref, by the id it carries. Rendering `((id))` into one is #2's.
    const ref = (event.target as Element)
      .closest('[data-block-ref]')
      ?.getAttribute('data-block-ref');
    if (ref) {
      event.preventDefault();
      event.stopPropagation();
      goToBlock(ref);
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
    if (page === title) return;
    event.stopPropagation();
    go(page);
  };

  return (
    <div onClickCapture={follow}>
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
            onClick={back}
          >
            ← {trail.at(-2) ?? 'Journal'}
          </button>,
          titlebar,
        )}

      {shown === null ? (
        <p className="mt-1 text-sm text-muted">Loading…</p>
      ) : (
        shown.map((page) => (
          // Keyed by the title, so a page is never handed another page's
          // editor state — the open box and the block id in it belong to the
          // page they were opened on.
          <PageView
            key={page.title}
            project={project}
            page={latest.get(page.title) ?? page}
            onPage={onPage}
            references={cuts(page.title)}
            act={act}
          />
        ))
      )}
    </div>
  );
}
