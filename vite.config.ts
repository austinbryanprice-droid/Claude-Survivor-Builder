import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Short commit id shown on the page so a deployed build can be matched to a commit.
const buildId = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);

export default defineConfig({
  // Relative base: the site is served from /Claude-Survivor-Builder/ on GitHub Pages.
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is about 500 kB minified; a real size budget arrives with the CI budgets.
    chunkSizeWarningLimit: 800,
    // Two pages: the game, and the throwaway look spike at look.html.
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        look: fileURLToPath(new URL('./look.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
