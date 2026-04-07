// @ts-check
import eslint from '@eslint/js';
import {defineConfig} from 'eslint/config';
import ts from 'typescript-eslint';

const typeCheckedConfig = ts.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['src/**/*.ts', 'vite.config.ts', 'vitest.config.ts'],
}));

const testConfig = ts.configs.recommended.map((config) => ({
  ...config,
  files: ['tests/**/*.ts'],
}));

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', 'assets/**'],
  },
  eslint.configs.recommended,
  ...testConfig,
  ...typeCheckedConfig,
  {
    files: ['src/**/*.ts', 'vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vite.config.ts', 'vitest.config.ts'],
        },
      },
    },
  },
);
