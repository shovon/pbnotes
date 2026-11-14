import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Project } from '../../shared/projects';
import ManageProjects from './ManageProjects';

const project = (id: string, name: string, path: string): Project => ({
  id,
  name,
  path,
  addedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: null,
  pinned: false,
});

const projects = [
  project('a', 'notes', '/Users/sal/Documents/notes'),
  project('b', 'work', '/Users/sal/Dropbox/work'),
  project('c', 'archive', '/Volumes/Backup/archive'),
  project('d', 'reading', '/Users/sal/reading'),
];

const meta = {
  component: ManageProjects,
  args: {
    projects,
    openId: 'a',
    directories: {
      a: '~/Documents/notes',
      b: '~/Dropbox/work',
      c: '/Volumes/Backup/archive',
      d: '~/reading',
    },
    availability: {},
    failures: {},
    onOpen: () => undefined,
    onAdd: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof ManageProjects>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A project open behind it: Escape, the backdrop and the × close it. Nothing known yet. */
export const Dismissable: Story = {};

/** No project open: nothing closes it until one opens. */
export const NoProjectOpen: Story = {
  args: { openId: null, onClose: undefined },
};

/**
 * A row in each state: open, missing (can't be clicked), failed to open this
 * session with why, and nothing known. `unknown` shows nothing, as `d` does.
 */
export const EveryStatus: Story = {
  args: {
    availability: { a: 'available', b: 'missing', c: 'available', d: 'unknown' },
    failures: { c: 'The folder holds notes but is not marked as a ledger.' },
  },
};

/** The launch that found the last project gone: none open, and it missing. */
export const LastProjectMissing: Story = {
  args: {
    openId: null,
    onClose: undefined,
    availability: { a: 'missing', b: 'available', c: 'available', d: 'available' },
    failures: { a: '"notes" is not reachable right now.' },
  },
};

/** What the app's notice says, shown in the modal, which would hide it. */
export const WithNotice: Story = {
  args: { openId: null, onClose: undefined, notice: '1 could not be read' },
};

/** Directories not answered yet: names alone. */
export const NoDirectoriesYet: Story = {
  args: { directories: {} },
};
