import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import Sidebar from './Sidebar';

const meta = {
  component: Sidebar,
  args: {
    recent: ['Mira', 'Reading list', '2026-10-28', 'Project Atlas'],
    showing: 'Mira',
    onJournal: fn(),
    onOpen: fn(),
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On a page: it heads the recent list, highlighted. */
export const Open: Story = {};

/** On the journal: the Journal entry is highlighted, and no page is. */
export const OnJournal: Story = { args: { showing: undefined } };

/** Nothing opened yet in this project. */
export const Empty: Story = { args: { recent: [], showing: undefined } };

/** A title longer than the column is cut to one line, whole on hover. */
export const LongTitle: Story = {
  args: {
    recent: [
      'Notes from the very long planning meeting about the reading list and everything after it',
      'Mira',
    ],
    showing: 'Mira',
  },
};
