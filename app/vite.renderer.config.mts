import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Forge's renderer config preserves symlinks, so a workspace package is
  // served from its `node_modules` link, which the watcher skips, and an edit
  // to it never reaches the window. Following the link serves it from
  // `packages/`, where it is watched.
  resolve: { preserveSymlinks: false },
  // A workspace package is source, not a dependency: pre-bundled, it is
  // cached under a hash of the lockfile, so an edit to it never reaches the
  // window. What it imports is still bundled, since some of that is CommonJS.
  optimizeDeps: {
    exclude: ['@pbnotes/graph'],
    include: ['unified', 'remark-parse', 'remark-math'],
  },
});
