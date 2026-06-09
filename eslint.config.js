import { default as defaultConfig } from '@cvr/config/eslint';

/** @type {import("eslint").Linter.Config} */
export default [
  {
    ignores: [
      'build/**',
      'public/**',
      'node_modules/**',
      '.claude/**',
      '.react-router/**',
    ],
  },
  ...defaultConfig,
  // add custom config objects here:
];
