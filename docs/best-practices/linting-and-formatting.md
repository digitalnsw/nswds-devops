# Linting & Formatting Rules

What is linted, where the configs live, and how the gates enforce it.

## The gates

| Tool | Scope | Where it runs |
| --- | --- | --- |
| commitlint | Every PR commit message | `commitlint / commitlint` (required check) |
| shellcheck | Shared shell scripts | This repo's CI |
| actionlint | Workflows + workflow stubs | This repo's CI |
| eslint | JS/TS source | `install / lint` (required check; runs `npm run lint --if-present`) |
| prettier | Formatting | `install / format` (required check; runs `prettier --check .` when the repo has a Prettier config) |
| Snyk | Dependencies + code | `security/snyk` and `code/snyk (DigitalNSW)` (required checks; posted by the Snyk console integration) |

`--if-present` and the format job's config probe mean a repo with no lint
script or no Prettier config passes those gates without running anything —
the gate is only as real as the repo's own wiring. Wire up every script the
repo can honestly run (see ONBOARDING.md step 2).

## Prettier

Prettier owns formatting; linters own correctness. The fleet style is
defined once in the `@nswds/prettier-config` npm package (single quotes, no
semicolons, 2-space indentation, printWidth 100, trailing commas) and every
repo consumes it — via the `package.json` `"prettier"` key when nothing is
layered on top, or a `.prettierrc.mjs` that spreads the base and adds local
plugins (the Tailwind repos). Style changes are made in the package and
reach the fleet as a normal version bump; nothing is hand-copied.

The synced `.mjs` configs (`commit-types.mjs`, `commitlint.config.mjs`,
`release.config.mjs`) are formatted in fleet style so every consumer's
`format:check` passes on them.

`.prettierignore` must exclude:

- `CHANGELOG.md` — semantic-release rewrites it unformatted on every
  release; leaving it checked re-reds the format gate at the next release.
- Generated and machine-written output — build artefacts, ORM meta
  snapshots, generated modules, email template HTML. Formatting generated
  files creates permanent churn against their generators, and email HTML is
  whitespace-sensitive.

Run `npm run format` locally (write mode); CI runs check mode only.

## ESLint

Flat config (`eslint.config.mjs`), centralised in the
`@nswds/eslint-config` npm package with two entry points:

- `@nswds/eslint-config` — Next.js apps: `core-web-vitals` +
  `typescript`, with the `fixupConfigRules` shim that keeps
  `eslint-config-next` working on ESLint 10.
- `@nswds/eslint-config/base` — everything else (token pipelines, IaC,
  node scripts, plain sites): `@eslint/js` + `typescript-eslint`
  recommended.

Both entry points enforce `'prettier/prettier': 'error'` and restrict
`no-console` to `warn`/`error`, so formatting violations surface as lint
errors and `npm run lint` reports everything in one command. Repos add only
thin, additive `globalIgnores` for repo-specific generated paths.

## Rules

- Linters run in CI, not just locally — a rule that isn't enforced by a
  check will drift. Husky hooks give faster local feedback but the CI gate
  is the source of truth (GitHub's web editors bypass local hooks entirely).
- Don't disable a rule inline without a reason comment. The shared scripts
  model this: every `shellcheck disable` names why.
- Formatting changes ship as their own `style:` commit/PR — never mixed into
  a behaviour change, where they bury the real diff. (`style:` releases a
  patch, deliberately, so formatting-only fixes still ship.)
- New repos inherit the shared configs via the sync and the npm packages —
  don't fork them locally; propose changes centrally so every repo moves
  together. A bespoke config needs a header comment naming why it diverges
  and what would let it converge (see the exceptions register in
  MAINTENANCE.md).
