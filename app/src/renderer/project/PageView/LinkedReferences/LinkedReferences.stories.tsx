import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Block, Page, PagesApi } from '../../../../shared/pages';
import LinkedReferences from './LinkedReferences';

/** Every call resolves `undefined`, like the preview's stub bridge. */
const pages = new Proxy({}, { get: () => async (): Promise<undefined> => undefined }) as PagesApi;

const block = (id: string, text: string, children: Block[] = []): Block => ({
  id,
  text,
  children,
});

const page = (title: string, blocks: Block[]): Page => ({ title, blocks });

/**
 * Writes resolve `undefined` through the stub above, so these
 * stories are for reading: the count, the cuts, and their headings.
 */
const meta = {
  component: LinkedReferences,
  args: { pages, act: () => undefined, onPage: () => undefined },
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
  },
};

/** One is singular. */
export const One: Story = {
  args: {
    references: [page('2026-09-24', [block('1', 'Ask [[Mira]].')])],
  },
};

/** Renders nothing at all — no heading, no empty list. */
export const None: Story = { args: { references: [] } };
