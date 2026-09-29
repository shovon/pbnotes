import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      // Forge writes every build into a single `.vite/build` directory, so the
      // main and preload entries — both `index.ts` — would otherwise collide
      // on `index.js`. Name the outputs after their layer instead.
      fileName: () => 'main.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      // `node:sqlite` is a prefix-only builtin, so it is absent from
      // `builtinModules` and from Forge's derived external list. Without an
      // explicit entry Rollup tries to bundle it and the main build fails.
      external: [
        'electron',
        'node:sqlite',
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
    },
  },
});
