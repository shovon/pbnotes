import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, Files } from 'lucide-react';
import Icon from './Icon';

const meta = {
  component: Icon,
  args: { of: CalendarDays },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At the app's one size and stroke, in the colour of the text around it. */
export const Default: Story = {};

/** It follows the text's colour, here the muted one. */
export const Muted: Story = { args: { of: Files, className: 'text-muted' } };
