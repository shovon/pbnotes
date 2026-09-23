import type { Meta, StoryObj } from '@storybook/react-vite';
import { BlockEditor } from './Block';

const meta = {
  component: BlockEditor,
  // `onContinue` is wired in every story on purpose: without it Enter falls
  // back to a newline, which is the opposite of what the box does in the app,
  // and the keys are most of what there is to try here.
  args: {
    onCommit: () => undefined,
    onContinue: () => undefined,
    onCancel: () => undefined,
  },
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

/** An existing block reopened, and the place to feel the keys: Enter ends
    the block, Shift+Enter is a newline, blur commits, Escape discards. */
export const Editing: Story = {
  args: { initial: 'Ordered the replacement hinge. Two weeks, apparently.' },
};

/** Empty, with a block behind it to delete: Backspace here removes the block
    rather than doing nothing. The same box the Editing story lands in after
    select-all and one Backspace. */
export const Emptied: Story = {
  args: { initial: '', onDelete: () => undefined },
};

/** Tab and Shift+Tab move the block a level rather than walking focus out of
    the box — wired here so the keys can be felt, though only the page can
    show where the block lands. Both are swallowed even at the edges, so a
    block with nowhere to go sits still instead of losing focus. */
export const Indentable: Story = {
  args: {
    initial: 'Two weeks, apparently.',
    onIndent: () => undefined,
  },
};

/** The other half of Block's Paragraphs story: same text, same height, or
    the block jumps when it opens. */
export const Paragraphs: Story = {
  args: {
    initial:
      'Ordered the replacement hinge. Two weeks, apparently.\n\nThe other one is fine, which is the annoying part.',
  },
};
