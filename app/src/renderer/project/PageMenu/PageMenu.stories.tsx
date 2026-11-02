import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import PageMenu from './PageMenu';

/**
 * A stand-in for main. Storybook has no native menu, so the menu picks
 * Delete Page… straight away when it is enabled, and nothing when it is not.
 */
const pages = {
  pageMenu: async (_at: { x: number; y: number }, offer?: { delete?: boolean }) =>
    offer?.delete ? ('delete' as const) : null,
};

const meta = {
  component: PageMenu,
  args: {
    title: 'Project Atlas',
    canDelete: true,
    impact: { links: 3, refs: 1 },
    pages,
    onDelete: fn(),
    act: (action: () => Promise<unknown>) => void action(),
  },
} satisfies Meta<typeof PageMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Something is on the page: the button opens the confirmation. */
export const CanDelete: Story = {};

/** Nothing on the page: Delete Page… is listed but disabled, so nothing opens. */
export const NothingToDelete: Story = {
  args: { canDelete: false },
};
