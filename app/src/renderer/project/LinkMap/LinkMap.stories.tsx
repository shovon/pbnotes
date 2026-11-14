import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import type { Edge, LinkMap as Map, Sub } from '@pbnotes/graph/link-map';
import LinkMap from './LinkMap';

/** The same numbers every time, so the map is the same map. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * A project of `pages` pages, each with an outline a few levels deep, its
 * blocks linking other pages and referring to other blocks, a few pages
 * tagging others, and a few with nothing on them.
 */
function project(pages: number, seed = 7): Map {
  const random = seeded(seed);
  const titles = Array.from({ length: pages }, (_, i) => `Page ${i + 1}`);
  const blocks: { id: string; page: string }[] = [];
  let next = 0;
  const outline = (page: string, count: number, depth: number): Sub[] =>
    Array.from({ length: count }, () => {
      const id = `b${next++}`;
      blocks.push({ id, page });
      const under = depth < 3 && random() < 0.35 ? 1 + Math.floor(random() * 4) : 0;
      return { id, children: outline(page, under, depth + 1) };
    });
  const forests = titles.map((title) => (random() < 0.15 ? [] : outline(title, 1 + Math.floor(random() ** 2 * 14), 0)));
  const edges: Edge[] = [];
  // The first few pages are linked far more than the rest, as hubs are.
  const some = () => titles[Math.floor(random() ** 2.5 * pages)];
  for (const { id, page } of blocks) {
    if (random() < 0.3) edges.push({ from: { page, block: id }, to: { page: some() }, kind: 'link' });
    if (random() < 0.08) {
      const to = blocks[Math.floor(random() * blocks.length)];
      if (to.id !== id) edges.push({ from: { page, block: id }, to: { page: to.page, block: to.id }, kind: 'ref' });
    }
  }
  for (const title of titles) {
    const to = some();
    if (random() < 0.1 && to !== title) edges.push({ from: { page: title }, to: { page: to }, kind: 'tag' });
  }
  const count = (subs: Sub[]): number => subs.reduce((n, sub) => n + 1 + count(sub.children), 0);
  return {
    pages: titles.map((title, i) => ({ title, blocks: count(forests[i]), forest: forests[i] })),
    edges,
  };
}

const bridge = (map: Map) => ({
  linkMap: async () => ({ version: 1, ...map }),
  blockPreviews: async (ids: string[]) =>
    ids.map((id): [string, string | null] => [id, `What block ${id} says, as far as its first paragraph.`]),
  onChanged: () => (): void => undefined,
});

const meta = {
  component: LinkMap,
  parameters: { layout: 'fullscreen' },
  args: { onOpen: fn(), onBlock: fn(), onError: fn() },
} satisfies Meta<typeof LinkMap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Project: Story = { args: { graph: bridge(project(60)) } };
export const Large: Story = { args: { graph: bridge(project(1500, 11)) } };
export const TwoPages: Story = {
  args: {
    graph: bridge({
      pages: [
        { title: 'Mira', blocks: 2, forest: [{ id: 'm1', children: [{ id: 'm2', children: [] }] }] },
        { title: 'Oslo', blocks: 1, forest: [{ id: 'o1', children: [] }] },
      ],
      edges: [
        { from: { page: 'Mira', block: 'm1' }, to: { page: 'Oslo' }, kind: 'link' },
        { from: { page: 'Mira', block: 'm2' }, to: { page: 'Oslo', block: 'o1' }, kind: 'ref' },
      ],
    }),
  },
};
export const Empty: Story = { args: { graph: bridge({ pages: [], edges: [] }) } };
