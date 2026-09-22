import type { Preview } from '@storybook/react-vite';
import '../src/renderer/index.css';
import 'katex/dist/katex.min.css';

// The views destructure `window.gnotes` at module scope, so the bridge has to
// exist before any story module is imported. ponytail: every call resolves
// undefined; give a story its own stub if it needs a real answer back.
window.gnotes = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => undefined }) },
) as typeof window.gnotes;

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'todo' },
  },
};

export default preview;
