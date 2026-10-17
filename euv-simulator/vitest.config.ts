import { defineConfig } from 'vitest/config';

// Unit and verification tests of the Engineering & Computational Science Lab (flow solver, heating, conduction,
// experiments, lab store). Kept separate from vite.config.ts so the application build is unchanged.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/lab/**/*.test.ts'],
    testTimeout: 120000,
  },
});
