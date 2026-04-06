// @ts-check
import eslint from '@eslint/js';
import * as eslintConfig from 'eslint/config';
import ts from 'typescript-eslint';

const typeCheckedConfig = ts.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['src/**/*.ts', 'vite.config.ts'],
}));

export default eslintConfig.defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...typeCheckedConfig,
  {
    files: ['src/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vite.config.ts'],
        },
      },
    },
  },
);
