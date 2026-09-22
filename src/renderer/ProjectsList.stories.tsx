import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Project } from '../shared/projects';
import ProjectsList from './ProjectsList';

const project = (over: Partial<Project> & Pick<Project, 'id' | 'name' | 'path'>): Project => ({
  addedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null,
  pinned: false,
  ...over,
});

const projects = [
  project({ id: 'a', name: 'gnotes', path: '/Users/sal/projects/gnotes', pinned: true, lastOpenedAt: new Date().toISOString() }),
  project({ id: 'b', name: 'Field notes', path: '/Volumes/archive/field-notes' }),
];

const meta = {
  component: ProjectsList,
  args: {
    projects,
    availability: { a: 'available', b: 'unknown' } as const,
    loading: false,
    act: (action: () => Promise<unknown>) => void action(),
    onAdd: () => undefined,
    onOpen: () => undefined,
  },
} satisfies Meta<typeof ProjectsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { projects: [], availability: {} } };

export const Loading: Story = { args: { projects: [], availability: {}, loading: true } };

/** A tracked directory that has gone away — an unplugged drive, a moved folder. */
export const Unavailable: Story = {
  args: { availability: { a: 'missing', b: 'unknown' } },
};
