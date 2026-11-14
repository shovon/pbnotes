import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphApi, LinkMapReply } from '../../../shared/graph';
import type { Keys } from '../opening/opening';
import { withoutDays } from './days/days';
import { flatten } from './flat/flat';
import type { Layout, Rank } from './grid/grid';
import { createScene } from './scene';
import type { Kept, Scene, Target } from './scene';

export type { Kept } from './scene';

/**
 * The graph view (#183): every page a bubble, holding its blocks as bubbles
 * of their own, with an arrow for every link, ref and tag. Zoomed out a
 * bubble is a dot and arrows run page to page; zoomed in it opens, and each
 * arrow runs from the block that holds it to the bubble it points at. Pinch
 * to zoom, drag or scroll to pan, drag a bubble to move it, click one to go
 * to it. Nothing here writes: where a bubble sits is this view's own. From
 * its top right corner, the journal's days can be left out of it, and the
 * blocks, so every page is one node and every arrow runs page to page; and
 * the map can be laid out as a grid, the most linked page first, ranked by
 * all its links, those coming in or those going out (`grid/`).
 *
 * Over the whole tab, under the title bar and beside the sidebars. Drawn
 * with WebGPU, which also runs the physics (`scene.ts`, `gpu.ts`,
 * `shaders.ts`); this is the fetching, the tooltip and the frame around it.
 *
 * Throwaway, with `@pbnotes/graph/link-map`: the folder, its stop on the
 * trail (`LINK_MAP`), its sidebar entry and its two channels go together.
 */
type Props = {
  /** The part of the bridge this calls. */
  graph: Pick<GraphApi, 'linkMap' | 'blockPreviews' | 'onChanged'>;
  /** A page's bubble was clicked, with the keys held (`opening/`). */
  onOpen: (page: string, keys: Keys) => void;
  /** A block's bubble was clicked. */
  onBlock: (id: string, keys: Keys) => void;
  /** A map that could not be read. */
  onError: (error: unknown) => void;
  /** Where the view leaves its camera, its bubbles' places and whether days show, so back to it finds it as it was. */
  kept?: { current: Kept | null };
};

type Tip = { target: Target; x: number; y: number };

export default function LinkMap({ graph, onOpen, onBlock, onError, kept }: Props) {
  const host = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLCanvasElement>(null);
  const own = useRef<Kept | null>(null);
  const box = kept ?? own;
  const [held, setHeld] = useState<LinkMapReply | null>(null);
  /** Whether the journal's days are on the map. */
  const [days, setDays] = useState(() => box.current?.days ?? true);
  const showDays = (on: boolean) => {
    setDays(on);
    box.current = { ...(box.current ?? { at: new Map() }), days: on };
  };
  /** Whether blocks show in their pages, or every page is one node. */
  const [blocks, setBlocks] = useState(() => box.current?.blocks ?? true);
  const showBlocks = (on: boolean) => {
    setBlocks(on);
    box.current = { ...(box.current ?? { at: new Map() }), blocks: on };
  };
  /** How the map is laid out: by its forces, or as a grid by how linked each page is. */
  const [layout, setLayout] = useState<Layout>(() => box.current?.layout ?? 'force');
  const lay = (next: Layout) => {
    setLayout(next);
    box.current = { ...(box.current ?? { at: new Map() }), layout: next };
  };
  /** What the grid ranks pages by. */
  const [rank, setRank] = useState<Rank>(() => box.current?.rank ?? 'links');
  const rankBy = (next: Rank) => {
    setRank(next);
    box.current = { ...(box.current ?? { at: new Map() }), rank: next };
  };
  /** The map as it shows. */
  const shown = useMemo(() => held && (days ? held : withoutDays(held)), [held, days]);
  const [scene, setScene] = useState<Scene | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  /** What each block hovered so far says; null for one the project lacks. */
  const [previews, setPreviews] = useState<ReadonlyMap<string, string | null>>(new Map());

  // Read as they are when a bubble is clicked, so the scene is made once.
  const latest = useRef({ onOpen, onBlock });
  latest.current = { onOpen, onBlock };

  useEffect(() => {
    let live = true;
    const ask = () =>
      graph.linkMap().then(
        (answer) => {
          if (!live) return;
          setHeld((current) => (current && current.version >= answer.version ? current : answer));
        },
        (error) => live && onError(error),
      );
    void ask();
    const off = graph.onChanged(() => void ask());
    return () => {
      live = false;
      // A stubbed bridge — Storybook's — may answer with no unsubscribe.
      if (typeof off === 'function') off();
    };
  }, [graph]);

  useEffect(() => {
    if (!host.current || !canvas.current || !labels.current) return;
    let live = true;
    let made: Scene | undefined;
    createScene({
      gpu: navigator.gpu,
      host: host.current,
      canvas: canvas.current,
      labels: labels.current,
      kept: box,
      onHover: (target, at) => setTip(target && { target, x: at.x, y: at.y }),
      onPick: (target, keys) =>
        target.block === undefined
          ? latest.current.onOpen(target.page, keys)
          : latest.current.onBlock(target.block, keys),
      onLost: (why) => setProblem(`The graphics device was lost: ${why}`),
    }).then(
      (it) => {
        if (!live) return it?.dispose();
        made = it;
        if (it) setScene(it);
        else setProblem('The graph view needs WebGPU, which this machine does not offer.');
      },
      (error) => live && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
      made?.dispose();
      setScene(null);
    };
  }, [box]);

  useEffect(() => {
    if (scene && shown) scene.setData(flatten(shown));
  }, [scene, shown]);

  useEffect(() => {
    scene?.setBlocks(blocks);
  }, [scene, blocks]);

  useEffect(() => {
    scene?.setLayout(layout);
  }, [scene, layout]);

  useEffect(() => {
    scene?.setRank(rank);
  }, [scene, rank]);

  // A block says what it is only when asked: once the pointer has rested on it a moment.
  const hovered = tip?.target.block;
  useEffect(() => {
    if (hovered === undefined || previews.has(hovered)) return;
    let live = true;
    const wait = setTimeout(() => {
      graph.blockPreviews([hovered]).then(
        (pairs) => live && setPreviews((known) => new Map([...known, ...pairs])),
        (): void => undefined,
      );
    }, 80);
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [hovered, graph]);

  const page = tip && shown?.pages.find((it) => it.title === tip.target.page);
  const said = tip?.target.block === undefined ? undefined : previews.get(tip.target.block);

  return (
    <section
      ref={host}
      aria-label="Graph"
      data-link-map
      className="fixed top-[calc(env(titlebar-area-y,0px)+env(titlebar-area-height,var(--spacing-titlebar))+1px)] right-0 bottom-0 left-0 touch-none overflow-hidden bg-bg select-none [body:has([data-aside])_&]:right-(--aside-width) [body:has([data-sidebar])_&]:left-sidebar"
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <canvas ref={labels} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
      {problem !== null ? (
        <p role="alert" className="absolute inset-x-0 top-1/3 px-6 text-center text-sm text-muted">
          {problem}
        </p>
      ) : held === null || shown === null ? (
        <p className="absolute top-4 left-6 text-sm text-muted">Loading…</p>
      ) : held.pages.length === 0 ? (
        <p className="absolute inset-x-0 top-1/3 px-6 text-center text-sm text-muted">
          No pages yet. Write in the journal, or link to a page, and it shows up here.
        </p>
      ) : shown.pages.length === 0 ? (
        <p className="absolute inset-x-0 top-1/3 px-6 text-center text-sm text-muted">
          Only journal days so far, and they are turned off.
        </p>
      ) : (
        <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-muted">
          {shown.pages.length} {shown.pages.length === 1 ? 'page' : 'pages'} · {shown.edges.length}{' '}
          {shown.edges.length === 1 ? 'link' : 'links'}
        </p>
      )}
      {problem === null && held !== null && held.pages.length > 0 && (
        // Over the map: a press on it is its own, never a pan (`scene.ts`).
        <div className="absolute top-3 right-4 flex items-center gap-3 rounded-md border border-line bg-bg/90 px-2 py-1 text-xs">
          <label className="flex items-center gap-1.5">
            Layout
            <select
              className="cursor-pointer rounded-sm border border-line bg-bg px-1 py-0.5"
              value={layout}
              onChange={(event) => lay(event.target.value === 'grid' ? 'grid' : 'force')}
            >
              <option value="force">Force-directed</option>
              <option value="grid">Grid</option>
            </select>
          </label>
          {layout === 'grid' && (
            <label className="flex items-center gap-1.5">
              Rank by
              <select
                className="cursor-pointer rounded-sm border border-line bg-bg px-1 py-0.5"
                value={rank}
                onChange={(event) => {
                  const picked = event.target.value;
                  rankBy(picked === 'in' || picked === 'out' ? picked : 'links');
                }}
              >
                <option value="links">Most links</option>
                <option value="in">Most incoming</option>
                <option value="out">Most outgoing</option>
              </select>
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="cursor-pointer accent-accent"
              checked={blocks}
              onChange={(event) => showBlocks(event.target.checked)}
            />
            Blocks
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="cursor-pointer accent-accent"
              checked={days}
              onChange={(event) => showDays(event.target.checked)}
            />
            Journal days
          </label>
        </div>
      )}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-80 rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm shadow-md"
          style={{
            top: Math.min(tip.y + 16, window.innerHeight - 120),
            left: Math.min(tip.x + 14, window.innerWidth - 336),
          }}
        >
          {tip.target.block === undefined ? (
            <>
              <div className="font-medium">{tip.target.page}</div>
              <div className="text-xs text-muted">
                {page?.blocks ?? 0} {page?.blocks === 1 ? 'block' : 'blocks'}
              </div>
            </>
          ) : (
            <>
              <div className="line-clamp-4 break-words">
                {said === undefined ? '…' : said === null || said === '' ? <span className="text-muted">Empty</span> : said}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted">{tip.target.page}</div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
