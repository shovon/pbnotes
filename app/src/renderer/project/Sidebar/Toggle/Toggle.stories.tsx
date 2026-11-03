import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import Toggle from './Toggle';

const meta = {
  component: Toggle,
  args: { collapsed: false, mac: true, onToggle: fn() },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The sidebar is showing: a click hides it. */
export const Expanded: Story = {};

/** The sidebar is hidden: a click shows it. */
export const Collapsed: Story = { args: { collapsed: true } };

/** Off macOS the label names Ctrl+\. */
export const NotMac: Story = { args: { mac: false } };
