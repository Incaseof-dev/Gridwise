import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    resolve: { alias: { '@core': resolve('src/core') } },
    // Build switches (src/core/buildFlags.ts): GRIDWISE_LIVE_COMBAT=1 npm run dist turns the live combat cues on.
    define: { __GRIDWISE_LIVE_COMBAT__: JSON.stringify(process.env.GRIDWISE_LIVE_COMBAT === '1') },
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@core': resolve('src/core') } },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          overlay: resolve('src/renderer/overlay/index.html'),
          settings: resolve('src/renderer/settings/index.html'),
        },
      },
    },
  },
});
