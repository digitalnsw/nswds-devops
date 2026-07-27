import { defineConfig, globalIgnores } from 'eslint/config'
import { fixupConfigRules } from '@eslint/compat'

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
//
// The eslint-config-next presets are wrapped in `fixupConfigRules` because
// ESLint 10 removed `context.getFilename()`, which eslint-plugin-react (pulled
// in transitively by eslint-config-next, incl. 16.2.11) still calls from its
// React-version *detection* path — every lint run then dies with
// `TypeError: contextOrFilename.getFilename is not a function` before checking
// a single file. The shim re-attaches the removed accessors, so the presets run
// unchanged on both ESLint 9 and 10. Drop the wrapper once eslint-config-next
// ships an ESLint-10-compatible eslint-plugin-react (vercel/next.js#89764).
const nswdsEslintConfig = defineConfig([
  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTs),
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
