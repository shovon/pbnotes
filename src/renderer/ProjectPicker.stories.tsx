import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Project } from '../shared/projects';
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
      project('a', 'gnotes', '/Users/sal/projects/gnotes'),
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
  args: { projects: [project('a', 'gnotes', '/Users/sal/projects/gnotes')] },
};
