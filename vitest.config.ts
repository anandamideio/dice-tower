import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: { runes: true },
    }),
  ],
  resolve: {
    alias: {
      '@dimforge/rapier3d': '@dimforge/rapier3d-compat',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    fileParallelism: false,
    setupFiles: ['tests/setup/foundry-globals.ts'],
    benchmark: {
      include: ['tests/**/*.bench.ts'],
      exclude: ['dist/**', 'node_modules/**'],
    },
  },
});
