import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn, userEvent, within } from 'storybook/test';
import Tags from './Tags';

/**
 * The chip row on its own. Writes go nowhere, so a tag added or removed goes
 * back to the tags handed in: these are for the chips, the input and what it
 * offers. A tag is offered whichever of these titles contain what is typed.
 * On its own, nothing hides "Add tag": that is the page header's doing.
 */
const titles = ['Work', 'Workshop', 'Reading', 'Home', 'Mira', 'Project Atlas'];

const meta = {
  component: Tags,
  args: {
    tags: [] as string[],
    findTags: async (query: string) =>
      titles.filter((title) => title.toLowerCase().includes(query.toLowerCase())),
    onAdd: fn(),
    onRemove: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tags>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No tags: only the way to add the first one. */
export const Empty: Story = {};

/** In `getTags` order. Hover a chip for its ×. */
export const WithChips: Story = {
  args: { tags: ['Home', 'Reading', 'Work'] },
};

/** A long title wraps inside its chip rather than being cut short. */
export const LongTitle: Story = {
  args: {
    tags: [
      'Work',
      'Notes from the very long planning meeting about the reading list and everything after it',
      'Home',
    ],
  },
};

/** The input open with "wo" typed: the pages offered leave out `Work`, which the row has. */
export const Adding: Story = {
  args: { tags: ['Work'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Add tag' }));
    await userEvent.type(canvas.getByRole('combobox', { name: 'Tag' }), 'wo');
  },
};
