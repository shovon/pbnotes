import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn } from 'storybook/test';
import TabStrip from './TabStrip';
import type { StripTab } from './TabStrip';

const meta = {
  component: TabStrip,
  args: {
    tabs: [{ id: 'a', label: 'Journal' }],
    active: 'a',
    onSelect: fn(),
    onClose: fn(),
    onNew: fn(),
    onMove: fn(),
  },
} satisfies Meta<typeof TabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One tab: what every window opens with, and still shown. */
export const One: Story = {};

/**
 * A few tabs, the second drawn, each the same width whatever it is called.
 * The others show their × when pointed at.
 */
export const Several: Story = {
  args: {
    tabs: [
      { id: 'a', label: 'Journal' },
      { id: 'b', label: 'Reading list' },
      { id: 'c', label: 'All pages' },
    ],
    active: 'b',
  },
};

/**
 * Pages with icons show them before their names (#323). A page whose icon
 * this build can't draw (an image icon from a newer one) shows its name
 * alone, as the journal does.
 */
export const WithIcons: Story = {
  args: {
    tabs: [
      { id: 'a', label: 'Journal' },
      { id: 'b', label: 'Reading list', icon: '📚' },
      { id: 'c', label: 'Project Atlas', icon: '🗺️' },
      { id: 'd', label: 'Shed', icon: 'image:3f2a' },
    ],
    active: 'b',
  },
};

/**
 * A name too long for its tab is cut short; the full name is its tooltip.
 * The tab is no wider for it than the short one beside it.
 */
export const LongName: Story = {
  args: {
    tabs: [
      { id: 'a', label: 'Journal' },
      { id: 'b', label: 'A page whose name goes on far longer than any tab is wide' },
    ],
    active: 'b',
  },
};

/**
 * More tabs than fit: they shrink alike to the narrowest a short name
 * reads in, then the strip scrolls sideways.
 */
export const Many: Story = {
  args: {
    tabs: Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, label: `Page ${i + 1}` })),
    active: 't3',
  },
};

/**
 * Opening, closing, switching and dragging a tab along, held here as
 * `ProjectView` holds them.
 * Open a few, then close them with their ×: the widths hold until the
 * pointer leaves the strip.
 */
export const Working: Story = {
  render: function Render() {
    const [tabs, setTabs] = useState<StripTab[]>([{ id: '0', label: 'Journal' }]);
    const [active, setActive] = useState('0');
    const [count, setCount] = useState(1);
    return (
      <TabStrip
        tabs={tabs}
        active={active}
        onSelect={setActive}
        onNew={() => {
          const id = String(count);
          setCount(count + 1);
          setTabs([...tabs, { id, label: 'Journal' }]);
          setActive(id);
        }}
        onClose={(id) => {
          const left = tabs.filter((it) => it.id !== id);
          if (left.length === 0) return;
          setTabs(left);
          if (id === active) setActive(left[0].id);
        }}
        onMove={(id, index) => {
          const moved = tabs.find((it) => it.id === id);
          if (!moved) return;
          const rest = tabs.filter((it) => it.id !== id);
          rest.splice(index, 0, moved);
          setTabs(rest);
        }}
      />
    );
  },
};
