import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // See the note in `vite.main.config.ts`: both entries are `index.ts`
        // and both land in `.vite/build`, so the name has to be explicit.
        entryFileNames: 'preload.js',
      },
    },
  },
});
