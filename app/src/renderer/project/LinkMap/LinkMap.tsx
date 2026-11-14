import { useEffect, useRef, useState } from 'react';
import type { GraphApi, LinkMapReply } from '../../../shared/graph';
import type { Keys } from '../opening/opening';
import { flatten } from './flat/flat';
import { createScene } from './scene';
import type { Kept, Scene, Target } from './scene';

export type { Kept } from './scene';

/**
 * The graph view (#183): every page a bubble, holding its blocks as bubbles
 * of their own, with an arrow for every link, ref and tag. Zoomed out a
 * bubble is a dot and arrows run page to page; zoomed in it opens, and each
 * arrow runs from the block that holds it to the bubble it points at. Pinch
 * to zoom, drag or scroll to pan, drag a bubble to move it, click one to go
 * to it. Nothing here writes: where a bubble sits is this view's own.
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
  /** Where the view leaves its camera and its bubbles' places, so back to it finds it as it was. */
  kept?: { current: Kept | null };
};

type Tip = { target: Target; x: number; y: number };

export default function LinkMap({ graph, onOpen, onBlock, onError, kept }: Props) {
  const host = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLCanvasElement>(null);
  const own = useRef<Kept | null>(null);
  const [held, setHeld] = useState<LinkMapReply | null>(null);
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
      kept: kept ?? own,
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
  }, [kept]);

  useEffect(() => {
    if (scene && held) scene.setData(flatten(held));
  }, [scene, held]);

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

  const page = tip && held?.pages.find((it) => it.title === tip.target.page);
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
      ) : held === null ? (
        <p className="absolute top-4 left-6 text-sm text-muted">Loading…</p>
      ) : held.pages.length === 0 ? (
        <p className="absolute inset-x-0 top-1/3 px-6 text-center text-sm text-muted">
          No pages yet. Write in the journal, or link to a page, and it shows up here.
        </p>
      ) : (
        <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-muted">
          {held.pages.length} {held.pages.length === 1 ? 'page' : 'pages'} · {held.edges.length}{' '}
          {held.edges.length === 1 ? 'link' : 'links'}
        </p>
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
