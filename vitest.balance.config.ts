import { defineConfig } from 'vitest/config';

/** The balance report (Phase 5j), run by `npm run balance`. It prints, so it is not part of `npm test`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/report/**/*.report.ts'],
    // Print the report as it is, without the runner's heading above each block of it.
    onConsoleLog(log) {
      process.stdout.write(`${log}\n`);
      return false;
    },
  },
});
