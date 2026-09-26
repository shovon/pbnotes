import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Block, Page } from '../../../shared/pages';
import type { Project } from '../../../shared/projects';
import PageView from './PageView';

const project: Project = {
  id: 'a',
  name: 'gnotes',
  path: '/Users/sal/projects/gnotes',
  addedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null,
  pinned: false,
};

const block = (id: string, text: string, children: Block[] = []): Block => ({
  id,
  text,
  children,
});

const page = (title: string, blocks: Block[]): Page => ({ title, blocks });

/**
 * Writes resolve `undefined` through the preview's stub bridge, so these
 * stories are for reading: the page's heading, its blocks, and — stacked —
 * what separates one day from the next.
 */
const meta = {
  component: PageView,
  args: { project, act: () => undefined },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    initial: page('2026-09-24', [
      block('1', 'Ordered the replacement hinge. Two weeks, apparently.'),
      block('2', 'Shed', [block('3', 'Measure the second door before Friday')]),
    ]),
  },
};

/** Only today can be empty — a day whose blocks were all deleted is not in
    the stack at all — and it needs somewhere to click or there is no way in. */
export const Empty: Story = { args: { initial: page('2026-09-24', []) } };

/** A page a link named. Nothing about it is a day: the heading is whatever
    the link called it, and it holds blocks the same way. The links in it go
    on to other pages — including back to a day, by its date. */
export const Named: Story = {
  args: {
    initial: page('Mira', [
      block('7', 'Prefers #[[the good coffee]], says so every time.'),
      block('8', 'Asked about the hinge on [[2026-09-24]].'),
    ]),
  },
};

/** The default view of a project: every written day, newest first, today at
    the top. The check is that the headings do the separating on their own —
    two days of notes must not read as one long day. */
export const Stacked: Story = {
  args: { initial: page('2026-09-24', []) },
  render: (args) => (
    <>
      <PageView {...args} />
      <PageView
        {...args}
        initial={page('2026-09-23', [
          block('4', 'Called about the hinge. On order.'),
          block('5', 'The other door is fine, which is the annoying part.'),
        ])}
      />
      <PageView
        {...args}
        initial={page('2026-08-30', [block('6', 'Measured the shed.')])}
      />
    </>
  ),
};
