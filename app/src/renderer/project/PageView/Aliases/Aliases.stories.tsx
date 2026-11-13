import type { Meta, StoryObj } from '@storybook/react-vite';
// eslint-disable-next-line import/no-unresolved -- a package export, which the import plugin cannot follow
import { fn, userEvent, within } from 'storybook/test';
import type { HeldAlias, Inert as Why } from '@pbnotes/graph';
import Aliases from './Aliases';

/**
 * The alias row on its own (#383). Writes go nowhere, so an alias added or
 * removed goes back to the aliases handed in: these are for the chips, the
 * input and what it says. The hint answers as main would over a project
 * where `JS` has notes, `Jay` has aliases of its own and Python claims `Py`.
 * On its own, nothing hides "Add alias": that is the page header's doing.
 */
const answers: Record<string, Why> = {
  js: { why: 'own' },
  jay: { why: 'aliases' },
  py: { why: 'claimed', by: 'Python' },
  'nov 4th, 2024': { why: 'day', day: '2024-11-04' },
};

const meta = {
  component: Aliases,
  args: {
    aliases: [] as HeldAlias[],
    title: 'JavaScript',
    explain: async (alias: string) => answers[alias.toLowerCase()],
    onAdd: fn(),
    onRemove: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '36rem', paddingBottom: '3rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Aliases>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No aliases: only the way to add the first one. */
export const Empty: Story = {};

/** Ordered by `canonicalize`. Hover a chip for its ×. */
export const WithChips: Story = {
  args: { aliases: [{ alias: 'ECMAScript' }, { alias: 'ES' }, { alias: 'JScript' }] },
};

/** One dimmed chip for each reason an alias does nothing; hover one for why. */
export const Dimmed: Story = {
  args: {
    aliases: [
      { alias: 'ES' },
      { alias: 'Jay', inert: { why: 'aliases' } },
      { alias: 'JS', inert: { why: 'own' } },
      { alias: 'Nov 4th, 2024', inert: { why: 'day', day: '2024-11-04' } },
      { alias: 'Py', inert: { why: 'claimed', by: 'Python' } },
    ],
  },
};

/** The tab asked for `JS` and shows JavaScript: the `JS` chip is lit. */
export const OpenedBy: Story = {
  args: { aliases: [{ alias: 'ECMAScript' }, { alias: 'JS' }], opened: 'js' },
};

/** Types `typed` into a freshly opened input. */
const typing = (typed: string): Story['play'] => async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Add alias' }));
  await userEvent.type(canvas.getByRole('textbox', { name: 'Alias' }), typed);
};

/** A free name: no hint, Enter adds it. */
export const TypingFree: Story = { args: { aliases: [{ alias: 'ES' }] }, play: typing('ECMAScript') };

/** Rule 1: the name has notes of its own. */
export const HintOwn: Story = { play: typing('JS') };

/** Rule 4: the name has aliases of its own. */
export const HintAliases: Story = { play: typing('Jay') };

/** Rule 5: another page claims the name and sorts first. */
export const HintClaimed: Story = { play: typing('Py') };

/** Rule 2: a date name opens its day. */
export const HintDay: Story = { play: typing('Nov 4th, 2024') };

/** Refused: the page's own title. Enter writes nothing. */
export const RefusedTitle: Story = { play: typing('javascript') };

/** Refused: a `YYYY-MM-DD`, which no alias ever takes. */
export const RefusedDate: Story = { play: typing('2024-11-04') };
