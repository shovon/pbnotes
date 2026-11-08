import type { Meta, StoryObj } from '@storybook/react-vite';
import PageIcon from './PageIcon';

/** A page's icon as the tab strip and the header draw it (#323). */
const meta = {
  component: PageIcon,
  args: { icon: '🌲', className: 'text-2xl' },
} satisfies Meta<typeof PageIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Emoji: Story = {};

/** A flag is two code points, and one emoji. */
export const Flag: Story = { args: { icon: '🇫🇷' } };

/** A value this build can't draw (an image icon from a newer one): nothing shows. */
export const CannotDraw: Story = { args: { icon: 'image:3f2a' } };
