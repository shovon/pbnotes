import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import MenuButton from './MenuButton';

const meta = {
  component: MenuButton,
  args: { openMenu: fn(() => Promise.resolve()) },
  // In a strip the titlebar's height and colour, as it sits in the app.
  decorators: [
    (Story) => (
      <div className="flex h-titlebar w-80 items-center border-b border-line bg-bar">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MenuButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At the strip's far end. A click, or Alt pressed alone, asks for the menu. */
export const InTheStrip: Story = {};
