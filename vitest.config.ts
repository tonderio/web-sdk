import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify(version) },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'e2e/support/**/*.test.mjs',
    ],
  },
});
