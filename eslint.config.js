import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DOC = 'See docs/architecture.md.';

/** Import boundaries between the source layers. Simulation code must run in a Worker and under Vitest. */
function restrictImports(layers, { three = false } = {}) {
  const paths = three
    ? [{ name: 'three', message: `three.js is not allowed in this layer. ${DOC}` }]
    : [];
  const patterns = [];
  if (three) {
    patterns.push({ group: ['three/*'], message: `three.js is not allowed in this layer. ${DOC}` });
  }
  if (layers.length > 0) {
    patterns.push({
      group: layers.flatMap((layer) => [`**/${layer}`, `**/${layer}/**`]),
      message: `This layer must not import from ${layers.join(', ')}. ${DOC}`,
    });
  }
  return { 'no-restricted-imports': ['error', { paths, patterns }] };
}

export default defineConfig(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'docs'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.js', '*.ts', 'tests/**/*.ts', 'tests/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: restrictImports(['engine', 'world', 'systems', 'net', 'ui'], { three: true }),
  },
  {
    files: ['src/engine/**/*.ts'],
    rules: restrictImports(['world', 'systems', 'net', 'ui']),
  },
  {
    files: ['src/world/**/*.ts'],
    ignores: ['src/world/render/**'],
    rules: restrictImports(['engine', 'systems', 'net', 'ui'], { three: true }),
  },
  {
    files: ['src/systems/**/*.ts'],
    rules: restrictImports(['engine', 'net', 'ui'], { three: true }),
  },
  {
    files: ['src/net/**/*.ts'],
    rules: restrictImports(['engine', 'ui'], { three: true }),
  },
);
