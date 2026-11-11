import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import Sidebar from './Sidebar';

const meta = {
  component: Sidebar,
  args: {
    recent: ['Mira', 'Reading list', '2026-10-28', 'Project Atlas'],
    showing: 'Mira',
    browsing: false,
    onJournal: fn(),
    onAllPages: fn(),
    onOpen: fn(),
    onRecentMenu: fn(),
    recentCollapsed: false,
    onToggleRecent: fn(),
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On a page: it heads the recent list, highlighted. */
export const Open: Story = {};

/**
 * Pages with icons show them before their titles (#331); a page with none
 * shows `file-text`, as does one whose icon this build can't draw.
 */
export const WithIcons: Story = {
  args: {
    icons: new Map([
      ['Mira', '🌲'],
      ['Reading list', '📚'],
      ['Project Atlas', 'image:3f2a'],
    ]),
  },
};

/** On the journal: the Journal entry is highlighted, and no page is. */
export const OnJournal: Story = { args: { showing: undefined } };

/** On the list of every page: All pages is highlighted, and nothing else is. */
export const OnAllPages: Story = { args: { showing: undefined, browsing: true } };

/** Recent collapsed to its heading (#299): the chevron points right. */
export const RecentCollapsed: Story = { args: { recentCollapsed: true } };

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

/** Collapsed and pointed at: laid over the page, with a shadow off its edge. */
export const Floating: Story = { args: { floating: true } };
