import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { expect, fn, userEvent, within } from 'storybook/test';
import EmojiPicker from './EmojiPicker';

/**
 * The emoji picker on its own (#325), before anything uses it: the page
 * header will open it for a page's icon (#323). Every colour is a theme
 * token, so it follows the system's light or dark setting like the rest of
 * the app; switch the OS (or DevTools' "prefers-color-scheme") to see both.
 */
const meta = {
  title: 'EmojiPicker',
  component: EmojiPicker,
  args: {
    recent: [] as string[],
    // Fixed, so *Random* picks the same emoji every time in a story.
    random: () => 0.42,
    onPick: fn(),
    onRemove: fn(),
    onClose: fn(),
  },
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmojiPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing chosen yet: no *Remove*, and no recently used row. */
export const Empty: Story = {};

/** A page that has an icon: *Remove* shows beside *Random*. */
export const Chosen: Story = {
  args: { value: '🌲' },
};

/**
 * Some emoji used lately, most recent first, above the groups. A string that
 * isn't an emoji the picker offers (`image:abc`) is passed over.
 */
export const RecentlyUsed: Story = {
  args: { value: '🌲', recent: ['🌲', '📚', 'image:abc', '🚀', '☕', '🎯'] },
};

/** A search that matches, by name ("tree") and by keyword. */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox', { name: 'Search emoji' }), 'tree');
    await expect(canvas.getByRole('option', { name: 'evergreen tree' })).toBeVisible();
  },
};

/** A search that matches nothing says so. */
export const NoMatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox', { name: 'Search emoji' }), 'zzqx');
    await expect(canvas.getByText('No emoji match “zzqx”')).toBeVisible();
  },
};

/**
 * Keyboard only: focus starts in the search, the arrows move through the
 * grid, Enter picks, and Escape closes.
 */
export const Keyboard: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole('combobox', { name: 'Search emoji' });
    await expect(search).toHaveFocus();
    await userEvent.keyboard('happy');
    await userEvent.keyboard('{ArrowRight}{ArrowDown}{ArrowUp}');
    const picked = canvas.getByRole('option', { selected: true });
    await userEvent.keyboard('{Enter}');
    await expect(args.onPick).toHaveBeenCalledWith(picked.textContent);
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};
