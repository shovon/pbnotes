import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import DeletePage from './DeletePage';

const meta = {
  component: DeletePage,
  args: { title: 'Project Atlas', onConfirm: fn(), onCancel: fn() },
} satisfies Meta<typeof DeletePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing elsewhere points at the page: it and everything on it go. */
export const NothingPointsHere: Story = {
  args: { impact: { links: 0, refs: 0 } },
};

/** Other pages link to it by title, so it stays, empty, in search. */
export const LinkedByTitle: Story = {
  args: { impact: { links: 3, refs: 0 } },
};

/** Other pages quote its blocks with `((id))`; those will show as missing. */
export const BlocksReferenced: Story = {
  args: { impact: { links: 0, refs: 2 } },
};

/** Both, one line each. */
export const LinkedAndReferenced: Story = {
  args: { impact: { links: 1, refs: 1 } },
};
