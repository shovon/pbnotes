import type { Preview } from '@storybook/react-vite';
import '../src/renderer/index.css';
import 'katex/dist/katex.min.css';

// No `window.pbnotes` stub: the views take the bridge as props, so a story
// hands each one exactly what it needs.

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'todo' },
  },
};

export default preview;
