import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import Aside from './Aside';

/** Stand-ins for cards: the column is what these stories are about. */
const card = (title: string, lines: number) => (
  <section key={title} className="rounded-md border border-line p-3">
    <h2 className="mb-2 text-lg font-semibold">{title}</h2>
    {Array.from({ length: lines }, (_, i) => (
      <p key={i} className="text-sm">
        Line {i + 1}
      </p>
    ))}
  </section>
);

const meta = {
  component: Aside,
  args: { width: 360, onResize: fn(), children: [card('Mira', 3)] },
} satisfies Meta<typeof Aside>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One page kept open. */
export const One: Story = {};

/** More than fit: the column scrolls by itself, newest on top. */
export const Many: Story = {
  args: { children: [card('Reading list', 12), card('Mira', 20), card('2026-11-05', 8)] },
};

/** Dragged wider. */
export const Wide: Story = { args: { width: 560 } };
