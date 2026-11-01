import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Property } from '@pbnotes/pages';
import Properties from './Properties';

/**
 * The table on its own. Writes go nowhere, so a committed row goes back to
 * the rows handed in: these are for the rows, the open row and what it
 * refuses. A key is offered whichever of these titles contain what is typed.
 */
const titles = ['Status', 'Stage', 'Owner', 'Author', 'Due', 'Mira'];

const meta = {
  component: Properties,
  args: {
    rows: [] as Property[],
    findKeys: async (query: string) =>
      titles.filter((title) => title.toLowerCase().includes(query.toLowerCase())),
    onCommit: () => undefined,
    onRemove: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Properties>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No properties: only the way to add the first one. */
export const Empty: Story = {};

/** In key order, as `getProperties` lists them. Hover a row for its ×. */
export const WithRows: Story = {
  args: {
    rows: [
      { key: 'Owner', value: 'Mira' },
      { key: 'Status', value: 'doing' },
      { key: 'Due', value: '' },
    ],
  },
};

/** Click "+ Add property", then type `Status` and leave: refused, and the key flashes. */
export const TakenKey: Story = {
  args: { rows: [{ key: 'Status', value: 'doing' }] },
};

/** A value with a newline, from another writer, is shown and not edited. */
export const MultiLineValue: Story = {
  args: {
    rows: [
      { key: 'Address', value: '12 Hill Road\nLeeds' },
      { key: 'Status', value: 'doing' },
    ],
  },
};
