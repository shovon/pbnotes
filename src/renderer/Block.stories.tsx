import type { Meta, StoryObj } from '@storybook/react-vite';
import { Block } from './Block';

const meta = {
  component: Block,
  args: { onActivate: () => undefined },
  decorators: [
    // The page is the flex column the blocks are spaced by; a lone block
    // outside it sits flush against the frame and reads wider than it is.
    (Story) => (
      <div className="page" style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Block>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { text: 'Ordered the replacement hinge. Two weeks, apparently.' },
};

/** A single newline is a line break here, not a space — notes are written
    line by line, and Markdown's paragraph folding would run them together. */
export const LineBreaks: Story = {
  args: { text: 'Milk\nBread\nThe good coffee, if they have it' },
};

/** The height check: a blank line between paragraphs has to occupy exactly
    one line, the same as it does in the textarea, or the block resizes as it
    opens. Compare against BlockEditor's Editing story with the same text. */
export const Paragraphs: Story = {
  args: {
    text: 'Ordered the replacement hinge. Two weeks, apparently.\n\nThe other one is fine, which is the annoying part.',
  },
};

/** A block with nothing in it is allowed, so it has to stay a line you can
    see and click: one empty row with its dot, the same height the textarea
    opens at. Collapsed to its padding it would be unreachable — and there is
    no way to delete a block you cannot click. */
export const Empty: Story = {
  args: { text: '' },
};

export const Markdown: Story = {
  args: {
    text: [
      '## Shed, second pass',
      '',
      'Load-bearing wall is the **south** one, per [the survey](https://example.com).',
      '',
      '- Joists at 400mm',
      '- Felt before the battens',
      '',
      '> Do not cut the corner post.',
      '',
      '```sh',
      'rm -rf ~/regrets',
      '```',
    ].join('\n'),
  },
};

export const Math: Story = {
  args: {
    text: 'Inline $e^{i\\pi} + 1 = 0$, and the one worth the display:\n\n$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$',
  },
};

/** Half-typed TeX is the normal state of a block being written. It renders
    as flagged source rather than throwing the page away. */
export const BrokenMath: Story = {
  args: { text: 'Still working this out: $\\frac{1}{$' },
};

/** Nothing in a note is guaranteed to be narrow. Long words and wide code
    have to scroll or wrap inside the box, never push it out of the column. */
export const Overflow: Story = {
  args: {
    text: 'supercalifragilisticexpialidociousandthensomemoreforgoodmeasure\n\n```\necho "a line long enough that it has to scroll rather than widen the page it sits on"\n```',
  },
};
