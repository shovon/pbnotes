import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // A workspace package is source, not a dependency: pre-bundled, it is
  // cached under a hash of the lockfile, so an edit to it never reaches the
  // window. What it imports is still bundled, since some of that is CommonJS.
  optimizeDeps: {
    exclude: ['@pbnotes/pages'],
    include: ['unified', 'remark-parse', 'remark-math'],
  },
});
