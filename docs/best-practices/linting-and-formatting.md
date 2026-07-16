# Linting & Formatting Rules

What is linted, where the configs live, and the cross-repo constraints.

## The gates

| Tool | Scope | Where it runs |
| --- | --- | --- |
| commitlint | Every PR commit message | `commitlint / commitlint` (required check) |
| shellcheck | Shared shell scripts | This repo's CI |
| actionlint | Workflows + workflow stubs | This repo's CI |
| eslint | JS/TS source | Per-repo (`npm run lint`) |
| prettier | Formatting | Per-repo config; see constraint below |

## The 80-column rule for shared `.mjs` configs

The synced configs (`commit-types.mjs`, `commitlint.config.mjs`,
`release.config.mjs`) are checked by **different prettier configs in
different repos** — nswds-ui runs printWidth 80 / no semicolons, others run
printWidth 100. The same bytes must satisfy both, so in these files:

- keep every line ≤ 80 columns, semicolon-free;
- if an expression is long, restructure it (block body, extracted variable)
  rather than letting prettier wrap it — an 80-wrapped line gets *unwrapped*
  by a width-100 config and fails the other repo's check.

## Prettier

Prettier owns formatting; linters own correctness. House style (per-repo
`.prettierrc`, JS/TS repos):

- single quotes, no semicolons, 2-space indentation, trailing commas (ES5);
- `.prettierignore` excludes generated output (`build/`, `node_modules/`);
- run via `npm run format`, or on save with editor integration.

Repos differ on `printWidth` (80 vs 100) — which is exactly why the shared
`.mjs` configs follow the 80-column rule above.

## ESLint

Flat config (`eslint.config.mjs`). Next.js repos extend
`next/core-web-vitals` + `next/typescript`, plus
`plugin:prettier/recommended` with:

```js
'prettier/prettier': 'error'
```

so formatting violations surface as lint errors in `npm run lint` — one
command reports everything.

## Rules

- Linters run in CI, not just locally — a rule that isn't enforced by a
  check will drift. Husky hooks give faster local feedback but the CI gate
  is the source of truth (GitHub's web editors bypass local hooks entirely).
- Don't disable a rule inline without a reason comment. The shared scripts
  model this: every `shellcheck disable` names why.
- Formatting changes ship as their own `style:` commit/PR — never mixed into
  a behaviour change, where they bury the real diff. (`style:` releases a
  patch, deliberately, so formatting-only fixes still ship.)
- New repos inherit the shared configs via the sync — don't fork them
  locally; propose changes here so every repo moves together.
