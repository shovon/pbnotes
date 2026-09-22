import type { Meta, StoryObj } from '@storybook/react-vite';
import { BlockEditor } from './Block';

const meta = {
  component: BlockEditor,
  args: { onCommit: () => undefined, onCancel: () => undefined },
  decorators: [
    (Story) => (
      <div className="page" style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BlockEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new block: empty, with the prompt the page gives it. */
export const New: Story = {
  args: { placeholder: 'Write something…' },
};

/** An existing block reopened. Blur commits, Escape discards. */
export const Editing: Story = {
  args: { initial: 'Ordered the replacement hinge. Two weeks, apparently.' },
};

/** The other half of Block's Paragraphs story: same text, same height, or
    the block jumps when it opens. */
export const Paragraphs: Story = {
  args: {
    initial:
      'Ordered the replacement hinge. Two weeks, apparently.\n\nThe other one is fine, which is the annoying part.',
  },
};
