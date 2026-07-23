# @nswds/prettier-config

Shared Prettier config for the NSW Design System fleet — the single source of
truth for the formatting options that were previously copy-pasted into a
`.prettierrc` in every repo.

## Adopt in a repo

Install it, then reference it by name from `package.json` (delete the repo's
old `.prettierrc`):

```jsonc
// package.json
{
  "prettier": "@nswds/prettier-config"
}
```

That's the whole config for a plain repo. No local `.prettierrc` needed.

## Repos that use Tailwind

The base config deliberately omits the Tailwind plugin block, because
`tailwindStylesheet` is an app-specific path (`./src/app/globals.css` in the
Next.js apps) that doesn't exist in non-app repos. Tailwind repos extend the
base in a local `.prettierrc.mjs` instead of the `package.json` key:

```js
// .prettierrc.mjs
// The package exports JSON, so the import needs a JSON import attribute.
import base from '@nswds/prettier-config' with { type: 'json' }

export default {
  ...base,
  plugins: ['prettier-plugin-organize-imports', 'prettier-plugin-tailwindcss'],
  tailwindFunctions: ['clsx'],
  tailwindStylesheet: './src/app/globals.css',
}
```

## Changing the shared options

Edit `index.json` here, bump the version, publish. Consumers pick it up on their
next `npm update` (Renovate will open the bump PRs).
