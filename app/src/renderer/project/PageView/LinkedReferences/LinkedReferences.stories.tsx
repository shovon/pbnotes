import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Block, Page } from '@pbnotes/graph';
import type { PageViewGraph } from '../PageView';
import LinkedReferences from './LinkedReferences';

/**
 * Writes go nowhere and search finds nothing. A plain object, not a Proxy:
 * Storybook calls `String(pages)` for the source snippet, and a Proxy that
 * answers every key answers `toString` with a Promise (#162).
 */
const graph: PageViewGraph = {
  run: async () => undefined,
  search: async () => [],
  aliasing: async () => undefined,
  blockMenu: async () => null,
  carryImages: async (images) => images.map((): string | undefined => undefined),
};

const block = (id: string, text: string, children: Block[] = []): Block => ({
  id,
  text,
  children,
});

const page = (title: string, blocks: Block[]): Page => ({ title, blocks });

/**
 * Writes resolve `undefined` through the stub above — no version, so what
 * they draw is dropped at once — and these stories are for reading: the count, the cuts, and their headings.
 */
const meta = {
  component: LinkedReferences,
  args: { graph, version: 0, scope: 'Mira', act: () => undefined },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LinkedReferences>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Under the page `Mira`: two days and a named page mention her. The blocks
    are shown as they are, links and all, with a linking block's children
    beneath it, and open for editing when clicked like any block; the page
    titles are links. */
export const Default: Story = {
  args: {
    references: [
      page('2026-09-24', [
        block('1', 'Ask [[Mira]] whether the hinge is the right one.'),
      ]),
      page('2026-09-23', [
        block('2', 'Coffee with #Mira', [
          block('3', 'She thinks the second door is fine too.'),
          block('4', 'Bring the #[[the good coffee]] next time.'),
        ]),
        block('5', 'Then home. #Mira waved from the bus.'),
      ]),
      page('Shed', [block('6', 'Second door: measure, then ask #Mira.')]),
    ],
    count: 4,
  },
};

/** A page many blocks link to, its first chunk loaded (#285): the heading
    counts every one, and the rest load as the window scrolls. */
export const PartlyLoaded: Story = {
  args: {
    references: [
      page('2026-09-24', [block('1', 'Ask [[Mira]] whether the hinge is the right one.')]),
      page('2026-09-23', [block('2', 'Coffee with #Mira')]),
    ],
    count: 340,
  },
};

/** Nothing loaded yet, on a page whose own blocks are still in view: the
    heading alone, saying what is below. */
export const NoneLoaded: Story = { args: { references: [], count: 340 } };

/** One is singular. */
export const One: Story = {
  args: {
    references: [page('2026-09-24', [block('1', 'Ask [[Mira]].')])],
    count: 1,
  },
};

/** Renders nothing at all — no heading, no empty list. */
export const None: Story = { args: { references: [], count: 0 } };
