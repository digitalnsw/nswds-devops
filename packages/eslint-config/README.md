# @nswds/eslint-config

Shared ESLint **flat** config for the NSW Design System fleet — the single
source of truth for what was previously a hand-maintained `eslint.config.mjs` in
every repo. Next.js `core-web-vitals` + `typescript`, with Prettier enforced as
an ESLint rule and `no-console` restricted to `warn`/`error`.

## Adopt in a repo

Install the package and its peers:

```bash
npm i -D @nswds/eslint-config eslint eslint-config-next \
  eslint-config-prettier eslint-plugin-prettier @eslint/compat
```

Then reduce the repo's `eslint.config.mjs` to the shared config plus any
repo-specific ignores/overrides:

```js
// eslint.config.mjs
import { defineConfig, globalIgnores } from 'eslint/config'
import nswds from '@nswds/eslint-config'

export default defineConfig([
  ...nswds,
  // repo-specific ignores (build artifacts this repo generates):
  globalIgnores(['src/lib/blocks/generated.ts']),
])
```

A repo with nothing extra just does `export default [...nswds]`.

### Per-repo rule overrides

Append a config object after `...nswds`. Example — a repo whose build scripts
are CLIs that legitimately print to stdout:

```js
export default defineConfig([
  ...nswds,
  { files: ['scripts/**/*.mjs'], rules: { 'no-console': 'off' } },
])
```

## Notes

- `baseIgnores` is exported if a repo needs to reference or extend the ignore
  list directly.
- Repos still on the older array-style config (`const config = [...]`) or a
  hand-rolled `@eslint/compat` `fixupConfigRules` shim (nswds-email) should
  migrate to the spread form above during rollout. The shim is now applied
  inside this package, so adopting repos delete their local wrapper — they do
  not need to call `fixupConfigRules` themselves.
- **ESLint 10 compatibility.** This config wraps the `eslint-config-next`
  presets in `fixupConfigRules`, because ESLint 10 removed
  `context.getFilename()` and eslint-plugin-react (transitive via
  eslint-config-next, incl. 16.2.11) still calls it during React-version
  detection — without the shim every lint run dies with
  `TypeError: contextOrFilename.getFilename is not a function`. Verified
  identical output on ESLint 9.39.5 and 10.8.0, so the wrapper is safe to carry
  while the fleet is mid-upgrade. Remove it once eslint-config-next ships an
  ESLint-10-compatible eslint-plugin-react (vercel/next.js#89764).
