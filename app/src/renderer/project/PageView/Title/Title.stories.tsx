import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { expect, fn, userEvent, within } from 'storybook/test';
import Title from './Title';

/**
 * A page's title on its own view (#109). Renames go nowhere here: one that
 * resolves shows the new title until the page would arrive under it, and
 * the refused story's rejects with main's message, IPC prefix and all, as
 * the bridge hands it over.
 */
const meta = {
  component: Title,
  args: {
    title: 'Bridal Falls',
    onRename: fn(async () => undefined),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Title>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As a page shows it: a heading. A click opens it for editing. */
export const AtRest: Story = {};

/** Open, with the title selected, so typing replaces it. */
export const Editing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Bridal Falls' }));
    await expect(canvas.getByRole('textbox', { name: 'Page title' })).toHaveFocus();
  },
};

/** Renamed to a page that already has content: the field stays open with what was typed, and says why. */
export const Refused: Story = {
  args: {
    onRename: fn(async () => {
      throw new Error(
        "Error invoking remote method 'graph:command': Error: “Waterfalls” already has content",
      );
    }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Bridal Falls' }));
    const field = canvas.getByRole('textbox', { name: 'Page title' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Waterfalls{Enter}');
    await expect(args.onRename).toHaveBeenCalledWith('Waterfalls');
    await expect(await canvas.findByRole('alert')).toHaveTextContent('already has content');
    await expect(field).toHaveValue('Waterfalls');
  },
};
