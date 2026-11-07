import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Project } from '../../shared/projects';
import ProjectPicker from './ProjectPicker';

const project = (id: string, name: string, path: string): Project => ({
  id,
  name,
  path,
  addedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null,
  pinned: false,
});

const meta = {
  component: ProjectPicker,
  args: {
    projects: [
      project('a', 'pbnotes', '/Users/sal/projects/pbnotes'),
      project('b', 'Field notes', '/Volumes/archive/field-notes'),
    ],
    projectId: 'a',
    onSelect: () => undefined,
    onAdd: () => undefined,
  },
} satisfies Meta<typeof ProjectPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The only project there is: the menu is still how you open another. */
export const Single: Story = {
  args: { projects: [project('a', 'pbnotes', '/Users/sal/projects/pbnotes')] },
};

/**
 * A name longer than the room the title bar leaves it: cut short, and shown
 * whole when pointed at. The frame stands in for the cap `App` puts on it.
 */
export const LongName: Story = {
  args: {
    projects: [
      project('a', 'A project with a name that goes on well past the sidebar', '/Users/sal/long'),
      project('b', 'Field notes', '/Volumes/archive/field-notes'),
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', maxWidth: '10rem' }}>
        <Story />
      </div>
    ),
  ],
};
