import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'public/data/**',
      'public/export/**',
      'ref/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'server/**/*.{js,mjs}', 'tests/**/*.js', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
]
