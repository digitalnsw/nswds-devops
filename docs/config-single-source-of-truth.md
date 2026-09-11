# Config single source of truth

Where each root config file that every fleet repo carries is owned, and how
it reaches the repos. There are three delivery mechanisms, because the
file-sync action (`BetaHuhn/repo-file-sync-action`) overwrites the whole
destination file: fine for files that are identical fleet-wide, destructive
for files that carry legitimate per-repo content.

| File | Mechanism | Canonical source | Status |
|---|---|---|---|
| `.nvmrc` | A: whole-file sync | `repo-files/.nvmrc` (`24.16.0`) | Synced to all groups |
| `.npmrc` | A: whole-file sync | `repo-files/.npmrc`; `repo-files/.npmrc-nswds-ui` for nswds-ui and nswds-email-design | Synced to all groups |
| `renovate.json` | A: whole-file sync | `repo-files/renovate.json` | Synced to all groups |
| `eslint.config.mjs` | B: npm package | `@nswds/eslint-config` | Adopted (see exceptions) |
| `.prettierrc` | B: npm package | `@nswds/prettier-config` | Adopted fleet-wide |
| `.snyk` | C: block sync | `snyk-policy/base.snyk` | Delivered to all 29 repos |
| `.gitignore` | C | `repo-files/.gitignore` (base only) | **No delivery mechanism** (open issue) |
| `.prettierignore` | C | `repo-files/.prettierignore` (base only) | **No delivery mechanism** (open issue) |

## Mechanism A: whole-file sync

For files that are byte-identical everywhere. Mapped in `.github/sync.yml`
from `repo-files/` to the repo root.

**`.nvmrc`** pins `24.16.0` in every repo. The reusable workflows read it
for every Node setup step.

**`.npmrc`** sets `engine-strict=true`, which turns the `engines` floor in
`package.json` (`^22.22.2 || >=24.15.0`) into a hard install error instead of
a warning. Nothing else enforces the floor: CI takes its Node version solely
from `.nvmrc`, so without this an `.nvmrc` edit below the floor would install
and pass CI silently. Keep `engines` in step with `.nvmrc`.

nswds-ui and nswds-email-design take the `repo-files/.npmrc-nswds-ui`
variant, which adds `provenance=false`. npm only supports provenance
attestation for public source repositories; with it enabled on a private
repo every publish fails with E422 and releases strand as git tags that never
reach npm. nswds-email-design is private. nswds-ui is now public, so its use
of the variant is a pending decision recorded in
[MAINTENANCE.md](../MAINTENANCE.md#decisions-required).

## Mechanism B: shared npm packages

For config that every repo needs but each may extend. A copied file cannot
express "shared base plus local override"; an npm package can.

| Package | Replaces | Consumer usage | Home |
|---|---|---|---|
| `@nswds/eslint-config` (1.1.2) | per-repo `eslint.config.mjs` | `export default defineConfig([...nswds, globalIgnores(['repo-specific/**'])])`, or `@nswds/eslint-config/base` for non-Next repos | [digitalnsw/nswds-eslint-config](https://github.com/digitalnsw/nswds-eslint-config) |
| `@nswds/prettier-config` (1.0.1) | per-repo `.prettierrc` | `"prettier": "@nswds/prettier-config"` in `package.json`, or a `.prettierrc.mjs` that extends it | [digitalnsw/nswds-prettier-config](https://github.com/digitalnsw/nswds-prettier-config) |

Both repos are public, MPL-2.0 (matching `@nswds/tokens`), release with
semantic-release over OIDC trusted publishing (no `NPM_TOKEN`), and publish
`access: "public"`. Each carries a CI smoke test for its own silent-failure
mode: the ESLint config lints a real JSX file (guards the ESLint 10
`getFilename` crash through `eslint-config-next`), and the Prettier config
resolves every option through Prettier's own support info (typo'd keys are
ignored rather than rejected). Renovate keeps both current in every consumer
and automerges their minors and patches, because the `install / lint` and
`install / format` gates measure their whole effect.

The Prettier package has two consumer shapes because the `package.json` key
takes a bare package reference and cannot add options. Base-only repos use
the key (nswds-tokens, the config packages, digitalnsw, dtl-sandbox, share).
Every Tailwind repo needs the plugin block and an app-specific
`tailwindStylesheet`, so it extends in a `.prettierrc.mjs`:

```js
import base from '@nswds/prettier-config' with { type: 'json' }

const config = {
  ...base,
  plugins: ['prettier-plugin-organize-imports', 'prettier-plugin-tailwindcss'],
  tailwindFunctions: ['clsx'],
  tailwindStylesheet: './src/app/globals.css',
}

export default config
```

Assign to a variable rather than exporting the object literal: repos lint
their own `.prettierrc.mjs`, and the literal form warns under
`import/no-anonymous-default-export`, which `@nswds/eslint-config` inherits
from `eslint-config-next/core-web-vitals`.

Adoption: `@nswds/eslint-config` is used by 17 repos. nswds-tokens keeps a
bespoke `eslint.config.js` (its header says to converge on `./base` at the
next change). nswds-ui and nswds-email-design extend through their own
`@workspace/eslint-config`; nswds-email-design's workspace config depends on
`@nswds/eslint-config`, nswds-ui's does not. `@nswds/prettier-config` is used
by 24 repos, including both workspace monorepos through
`@workspace/prettier-config`. No hand-copied `.prettierrc` remains.

## Mechanism C: base plus repo-specific tail

For files with a large common core where every repo legitimately appends
its own entries. There is no "extends" for ignore files, and a whole-file
sync would delete each repo's tail. The convention is a canonical block at
the top of the file, then a `# repo-specific` marker, then the repo's own
lines below it.

### `.snyk` (delivered)

The canonical block lives in [`snyk-policy/base.snyk`](../snyk-policy/base.snyk)
and ends with a `  # repo-specific` marker. `.github/scripts/snyk-policy.mjs`
rewrites everything down to and including that marker and copies the tail
through byte-for-byte; it never parses, reorders or reformats the tail, so a
repo cannot lose policy it owns. The only byte it may add is a trailing
newline. Delivery is one PR per repo on a `chore/repo-sync/snyk-policy`
branch, driven by `.github/workflows/snyk-policy-sync.yml` when the base
changes, with `.github/workflows/snyk-policy-canary.yml` probing weekly for
drift. Consumers are declared in [`snyk-policy/repos.json`](../snyk-policy/repos.json);
all 29 fleet repos (the 28 consumers plus nswds-devops) are plain keys, and
no `migrate` directive remains. `.snyk` stays absent from `.github/sync.yml`
on purpose: the block sync is a different mechanism, not an exception to the
whole-file constraint. Operating detail: [snyk-policy/README.md](../snyk-policy/README.md).

What the base contains:

- Enumerated licence acceptances for weak-copyleft (MPL-2.0, LGPL-3.0) and
  permissive (Artistic-2.0) findings on unmodified, transitively-installed
  build and runtime libraries: the sharp/libvips platform binaries via next,
  the lightningcss platform binaries via Tailwind, axe-core, npm bundled
  inside semantic-release, and the `@nswds/*` packages.
- Scoped vulnerability acceptances for the npm-vendored undici advisories,
  scoped `* > npm > * > undici` and expiring 2026-12-31.
- **No `'*:lic:*'` catch-all.** Snyk matches ignore keys as exact issue IDs
  and does not support globs, so a catch-all is dead config that reads as
  protection. Licence findings must be enumerated.
- **No nanoid CWE-835 ignores.** Every repo resolves the postcss-introduced
  nanoid to 3.3.17 or 3.3.18, which carry both fixes, and scanning with
  `--ignore-policy` reports no nanoid findings. Do not re-add them
  speculatively; if either advisory returns, re-triage on the evidence at
  that time.

Repo-owned policy that the tail preserves: nswds-email-framework excludes
its generated `docs/` and `build_local/` from Snyk Code (about 7,000 files;
without it a root scan times out), nswds-tokens accepts a `javascript/PT`
finding in one developer script, nswds-app accepts two transitive postcss
advisories, and dtl-sandbox path-scopes js-yaml and the npm bundle.

### `.gitignore` and `.prettierignore` (not delivered)

The canonical bases are `repo-files/.gitignore` and `repo-files/.prettierignore`.
The `.gitignore` base normalises the `.claude` versus `/.claude` split, folds
in the AI-tooling and Snyk-output ignores, and includes `*.err`. Neither file
is in the sync map, and nothing checks that a repo's file matches the base.

## Open issues

**Ignore files have no delivery mechanism.** `.gitignore` and
`.prettierignore` drift freely across the fleet. The intended fix is to reuse
the `.snyk` block sync unchanged: the same base plus marker plus preserved
tail shape, the same fan-out and canary, generalised from `snyk-policy.mjs`
to take the file name and base as parameters. No new machinery is needed.
Until then, a new repo copies the base by hand (ONBOARDING.md steps 2 and 3).

## Repos excluded from convergence

- **nswds-ui**: monorepo; heavily-commented `.prettierignore`, `.npmrc`
  variant. Extends the packages through workspace configs but keeps its own
  ignore files.
- **nswds-email-design**: same shape as nswds-ui.
- **nswds-email-framework**, **nswds-email-starter**: Maizzle projects;
  their ignores cover Maizzle build artifacts, not Next.js. Not consumers of
  the Next-based ESLint entry point.
- **ictds-portal-flows**: Power Platform; has no ESLint or Prettier config.
