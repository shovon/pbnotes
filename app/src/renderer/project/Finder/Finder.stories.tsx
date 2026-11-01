import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import Finder from './Finder';
import type { Found, FoundBlock } from './results/results';

const titles = ['Mira', "Mirabel's notes", 'Project Atlas', 'Shed', '2026-10-12', '2026-10-13'];

/** Block text as it is shown: links already read, so `[[Mira]]` is `Mira`. */
const blocks: FoundBlock[] = [
  { id: 'b1', page: '2026-10-12', text: 'Call Mira about the lease' },
  {
    id: 'b2',
    page: 'Project Atlas',
    text: 'Met with Mira and Sam re: pricing',
  },
  { id: 'b3', page: 'Shed', text: 'Second door: measure, then ask Mira.' },
  {
    id: 'b4',
    page: '2026-10-13',
    text: 'A long one, to show the cut: Mira thinks the hinge on the second door is the wrong size, and the shop that sold it closes on Sundays, so it waits until next week at the earliest.',
  },
  {
    id: 'b5',
    page: 'Project Atlas',
    text: 'Pricing page draft is in the shared folder',
  },
];

/**
 * A stand-in for main: titles containing the query, those starting with it
 * first, then blocks containing it. Main does the same over the real fold.
 */
const find = async (query: string): Promise<Found> => {
  const q = query.trim().toLowerCase();
  const has = (text: string) => text.toLowerCase().includes(q);
  return {
    pages: titles
      .filter(has)
      .sort(
        (a, b) =>
          Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)) ||
          a.localeCompare(b),
      ),
    blocks: blocks.filter((block) => has(block.text)),
  };
};

/**
 * Picking a row and closing the box show up under Actions. The box stays
 * open after either: in the app, `ProjectView` would unmount it.
 */
const meta = {
  component: Finder,
  args: { find, onOpen: fn(), onClose: fn() },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Finder>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Just opened: an empty box with the cursor in it. Type to search. */
export const Empty: Story = {};

/** `mira` typed: two pages, then the blocks that mention her, each with the
    page it is on. The first row is picked, so Enter opens `Mira`. */
export const Typed: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'mira');
  },
};

/** Down twice from `Typed`: the first block is picked, and Enter would open
    its page scrolled to it. */
export const BlockPicked: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'mira{ArrowDown}{ArrowDown}');
  },
};

/** Only blocks match: no Pages heading. */
export const BlocksOnly: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'hinge');
  },
};

/** Nothing matches. Whether this row should offer to create the page is an
    open question on #28. */
export const NoMatches: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'zebra');
  },
};

/** Search failed in main: shown the same as no matches. */
export const Failed: Story = {
  args: {
    find: async () => Promise.reject(new Error('The project is not reachable.')),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'mira');
  },
};
