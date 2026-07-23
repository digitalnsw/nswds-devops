import { defineConfig, globalIgnores } from 'eslint/config'

import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

import eslintConfigPrettier from 'eslint-config-prettier/flat'
import eslintPluginPrettier from 'eslint-plugin-prettier'

// The default ignore set. Consumers that need extra ignores should NOT edit
// this — they add their own `globalIgnores([...])` after spreading the config.
export const baseIgnores = [
  // Default ignores of eslint-config-next:
  '.next/**',
  'out/**',
  'build/**',
  'next-env.d.ts',
  'node_modules/**',
  '**/dist/**',
  // Fleet additions:
  '.github/workflows/**',
]

// The shared base config: Next.js core-web-vitals + TypeScript, with Prettier
// enforced as an ESLint rule and console output restricted to warn/error.
const nswdsEslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  eslintConfigPrettier,
  {
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  globalIgnores(baseIgnores),
])

export default nswdsEslintConfig
