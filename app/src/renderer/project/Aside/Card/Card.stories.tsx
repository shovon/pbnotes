import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import type { Block } from '@pbnotes/graph';
import type { PlaceView } from '../../../../shared/graph';
import Card from './Card';
import type { CardGraph } from './Card';

const block = (id: string, text: string, children: Block[] = []): Block => ({ id, text, children });

/** What main answers for the page: the same every time. */
const answer = (blocks: Block[]): PlaceView => ({
  version: 1,
  showing: [
    {
      page: { title: 'Reading list', blocks },
      references: [],
      links: 0,
      properties: [{ key: 'status', value: 'ongoing' }],
      tags: ['books'],
      taggedBy: [],
      deletions: 0,
      refsTo: 0,
    },
  ],
  previews: [],
});

/**
 * Writes go nowhere and nothing changes. A plain object, not a Proxy:
 * Storybook calls `String()` on args for the source snippet (#162).
 */
const graphOf = (blocks: Block[]): CardGraph => ({
  run: async () => undefined,
  search: async () => [],
  blockMenu: async () => null,
  carryImages: async (images) => images.map((): string | undefined => undefined),
  view: async () => answer(blocks),
  onChanged: () => () => undefined,
});

const meta = {
  component: Card,
  args: {
    graph: graphOf([
      block('1', 'The Dispossessed'),
      block('2', 'Piranesi', [block('3', 'Lent to [[Mira]]')]),
    ]),
    title: 'Reading list',
    now: () => new Date('2026-11-06T12:00:00'),
    scope: 'story',
    onClose: fn(),
    act: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ width: '22rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page with blocks, a tag and a property. */
export const Default: Story = {};

/** A page nothing is written on yet: the way in is the first block. */
export const Empty: Story = { args: { graph: graphOf([]) } };

/** Before main answers. */
export const Loading: Story = {
  args: { graph: { ...graphOf([]), view: () => new Promise<PlaceView>(() => undefined) } },
};
