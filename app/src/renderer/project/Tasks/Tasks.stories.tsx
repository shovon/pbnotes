import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { readTask } from '@pbnotes/graph';
import type { Block, Marker, Page } from '@pbnotes/graph';
import { OPEN_TASKS } from '../../../shared/graph';
import type { Filter, TaskView } from '../../../shared/graph';
import Tasks from './Tasks';
import type { TasksGraph } from './Tasks';

const block = (id: string, text: string, children: Block[] = []): Block => ({ id, text, children });
const page = (title: string, blocks: Block[]): Page => ({ title, blocks });

/** A small project's tasks, every marker among them. */
const PROJECT: Page[] = [
  page('2026-11-13', [
    block('1', 'DOING Reply about the quote for the ((q))'),
    block('2', 'TODO Book the electrician', [block('3', 'ask about the outside socket too')]),
  ]),
  page('2026-11-12', [block('4', 'DONE Pick up the tiles from [[Hardware store]]')]),
  page('Kitchen', [
    block('5', 'DOING Sand the south wall', [
      block('6', 'start from the window side'),
      block('7', 'TODO buy more sandpaper'),
    ]),
    block('8', 'TODO Order the grout'),
    block('9', 'DONE Measure the floor'),
  ]),
];

/** The markers a filter lets through, as main reads them. */
const markersOf = (filter: Filter): Set<Marker> =>
  new Set(filter.find((it) => it.kind === 'marker')?.markers ?? ['TODO', 'DOING', 'DONE']);

/** What main's `getTasks` does, over `pages`: tasks taken whole, others searched inside. */
function answer(pages: Page[], filter: Filter, next: string | null = null): TaskView {
  const markers = markersOf(filter);
  let shown = 0;
  let total = 0;
  const cut = (blocks: Block[]): Block[] =>
    blocks.flatMap((it) => {
      const task = readTask(it.text);
      if (task) total++;
      const taken = task !== undefined && markers.has(task.marker);
      if (taken) shown++;
      const inside = cut(it.children);
      return taken ? [it] : inside;
    });
  const cuts = pages.map((it) => page(it.title, cut(it.blocks))).filter((it) => it.blocks.length > 0);
  return {
    version: 1,
    pages: cuts,
    shown,
    total,
    previews: [['q', 'the back door']],
    list: { through: cuts.at(-1)?.title ?? null, next },
  };
}

/**
 * Writes go nowhere; the tasks are filtered here as main would filter them,
 * and the `+ Filter` menu, which is native, picks DONE each time it opens.
 * A plain object, not a Proxy (#162).
 */
const bridge = (pages: Page[], next: string | null = null): TasksGraph => ({
  run: async () => undefined,
  search: async () => [],
  blockMenu: async () => null,
  carryImages: async (images) => images.map((): string | undefined => undefined),
  onChanged: () => () => undefined,
  tasks: async (filter) => answer(pages, filter, next),
  filterMenu: async () => ({ kind: 'marker', marker: 'DONE' }),
});

/** The filter held as the tab would hold it, so the chips and `+ Filter` work. */
function Held({ start, ...props }: Omit<Parameters<typeof Tasks>[0], 'filter' | 'onFilter'> & { start: Filter }) {
  const [filter, setFilter] = useState(start);
  return <Tasks {...props} filter={filter} onFilter={setFilter} />;
}

const meta = {
  component: Held,
  args: { graph: bridge(PROJECT), start: OPEN_TASKS, scope: 'tasks', act: () => undefined },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Held>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As it opens: what is still to do, page by page, done tasks filtered out
    and counted in the heading. A task's children come with it, a task
    inside one shows only there, and each title links to its page. */
export const OpenTasks: Story = {};

/** No filter: every task, done ones struck through among the rest. */
export const Everything: Story = { args: { start: [] } };

/** Only what is done. */
export const Done: Story = { args: { start: [{ kind: 'marker', markers: ['DONE'] }] } };

/** Every task is done and the filter wants open ones: the heading still
    says how many there are. */
export const NothingMeetsTheFilter: Story = {
  args: { graph: bridge([page('Kitchen', [block('9', 'DONE Measure the floor')])]) },
};

/** A project with no task at all yet. */
export const NoTasks: Story = {
  args: { graph: bridge([page('Kitchen', [block('1', 'The tiles are blue')])]) },
};

/** More pages than one chunk: the rest load as the window scrolls. */
export const PartlyLoaded: Story = { args: { graph: bridge(PROJECT, 'Shed') } };
