import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import type { PageListing } from '@pbnotes/graph';
import type { GraphApi } from '../../../shared/graph';
import AllPages from './AllPages';
import { INITIAL, toggle } from './sort/sort';
import type { Sort } from './sort/sort';

const day = (iso: string) => Date.parse(iso);

const few: PageListing[] = [
  { title: '2026-11-01', blocks: 4, references: 0, taggedBy: 0, edited: day('2026-11-01T18:20:00Z') },
  { title: '2026-11-02', blocks: 2, references: 0, taggedBy: 0, edited: day('2026-11-02T09:05:00Z') },
  { title: 'Mira', blocks: 7, references: 5, taggedBy: 2, edited: day('2026-10-30T14:00:00Z') },
  { title: 'Project Atlas', blocks: 12, references: 3, taggedBy: 0, edited: day('2026-11-02T11:40:00Z') },
  // Only a link names it: nothing on it, so no time either.
  { title: 'Oslo', blocks: 0, references: 2, taggedBy: 0 },
  // Only tags name it: tagged by three pages, linked by none.
  { title: 'Work', blocks: 0, references: 0, taggedBy: 3 },
  { title: 'status', blocks: 0, references: 0, taggedBy: 0 },
];

const many: PageListing[] = Array.from({ length: 60 }, (_, i) => ({
  title:
    i % 7 === 0
      ? `Notes from the very long planning meeting number ${i}, about the reading list and everything after it`
      : `Page ${String(i).padStart(2, '0')}`,
  blocks: (i * 7) % 23,
  references: (i * 5) % 11,
  taggedBy: (i * 3) % 4,
  ...(i % 5 === 0 ? {} : { edited: day('2026-10-01T00:00:00Z') + i * 36e5 * 13 }),
}));

/** A stand-in for main: the list as it is, at version 1. */
const bridge = (pages: PageListing[]): Pick<GraphApi, 'pages' | 'onChanged'> => ({
  pages: async () => ({ version: 1, pages }),
  onChanged: () => () => undefined,
});

/** Holds the sort, as `ProjectView` does. */
function Sorting(props: Omit<Parameters<typeof AllPages>[0], 'sort' | 'onSort'> & { start?: Sort }) {
  const [sort, setSort] = useState(props.start ?? INITIAL);
  return <AllPages {...props} sort={sort} onSort={setSort} />;
}

const meta = {
  component: Sorting,
  args: {
    graph: bridge(few),
    onOpen: fn(),
    onError: fn(),
  },
} satisfies Meta<typeof Sorting>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A few pages, A to Z; a page only a link names is dimmed. */
export const Few: Story = {};

/** Nothing written yet. */
export const Empty: Story = { args: { graph: bridge([]) } };

/** Many pages, some with titles longer than the column. */
export const Many: Story = { args: { graph: bridge(many) } };

/** Most blocks first. */
export const ByBlocks: Story = { args: { start: toggle(INITIAL, 'blocks') } };

/** Most linked first. */
export const ByReferences: Story = { args: { start: toggle(INITIAL, 'references') } };

/** Most tagged first. Tags are their own count, never part of References. */
export const ByTaggedBy: Story = { args: { start: toggle(INITIAL, 'taggedBy') } };

/** Newest first; pages that never changed go last. */
export const ByLastEdited: Story = { args: { start: toggle(INITIAL, 'edited') } };

/** Pages with icons (#329): each before its title, `file-text` for one with none, and nothing raw for one this build can't draw. */
export const WithIcons: Story = {
  args: {
    graph: bridge(
      few.map((page) => {
        const icon = { Mira: '🌲', 'Project Atlas': '🗺️', Oslo: '🇳🇴', Work: 'image:abc' }[page.title];
        return icon === undefined ? page : { ...page, icon };
      }),
    ),
  },
};

/** Still waiting for main. */
export const Loading: Story = {
  args: {
    graph: { ...bridge([]), pages: () => new Promise(() => undefined) },
  },
};
