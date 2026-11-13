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

/** A new block: empty, with the prompt the page gives it. `onBackspace` is
    wired here too — in the app it backs out of the box rather than deleting
    anything, since there is no block behind it yet. */
export const New: Story = {
  args: { placeholder: 'Write something…', onBackspace: () => undefined },
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
  args: { initial: '', onBackspace: () => undefined },
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

/** Type `[[` or `#` and the project's pages are offered under it, narrowed
    by what follows: Up and Down to move, Enter, Tab or a click to pick,
    Escape to leave the text as typed. Not offered inside backticks. After
    `#`, a space or punctuation closes it, and a title with a space in it is
    picked as `#[[The good coffee]]`. An alias or a date name shows the page
    it opens: try `coffee` or `sep`. */
export const Linking: Story = {
  args: {
    initial: 'Asked about the hinge, see ',
    findPages: async (query) =>
      [
        { title: 'Hinges', opens: 'Hinges' },
        { title: 'Shed', opens: 'Shed' },
        { title: 'Mira', opens: 'Mira' },
        { title: 'The good coffee', opens: 'The good coffee' },
        { title: '2026-09-24', opens: '2026-09-24' },
        { title: 'Sep 24th, 2026', opens: '2026-09-24' },
        { title: 'Coffee', opens: 'The good coffee' },
      ].filter(({ title }) => title.toLowerCase().includes(query.toLowerCase())),
  },
};
