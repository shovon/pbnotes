import type { Meta, StoryObj } from '@storybook/react-vite';
import TaggedBy from './TaggedBy';
import { LIMIT } from './collapse/collapse';

/**
 * The section on its own, as it shows under the page `Work`. The titles are
 * links; the project view is what follows them.
 */
const meta = {
  component: TaggedBy,
  args: { tag: 'Work', pages: [] as string[] },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TaggedBy>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One page tags it. */
export const One: Story = { args: { pages: ['Project Atlas'] } };

/** Several, in `getTaggedBy` order. */
export const Several: Story = {
  args: { pages: ['2026-11-02', 'Mira', 'Project Atlas'] },
};

/** A page that tags itself lists itself: nothing special about it. */
export const Itself: Story = {
  args: { pages: ['Mira', 'Work'] },
};

/** More than fit: the first ones, and a way to show the rest. Click it to expand. */
export const Many: Story = {
  args: {
    pages: Array.from({ length: LIMIT + 14 }, (_, i) => `Meeting ${String(i + 1).padStart(2, '0')}`),
  },
};

/** Nothing tags it: no section at all. */
export const Empty: Story = {};
