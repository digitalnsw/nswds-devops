# Config single source of truth

Six config files had drifted across the fleet with no canonical version:
`.nvmrc`, `.npmrc`, `.gitignore`, `eslint.config.mjs`, `.prettierrc`,
`.prettierignore`. This establishes one source of truth for each and a rollout
plan to converge the 22 repos onto it.

The files split into three distribution mechanisms, because the file-sync action
(`BetaHuhn/repo-file-sync-action`) **overwrites the whole destination file** —
fine for files that are identical fleet-wide, destructive for files that carry
legitimate per-repo content.

## Mechanism A — whole-file sync (`repo-files/` → root)

For files that are (or should be) byte-identical everywhere.

| File | Canonical | Notes |
|------|-----------|-------|
| `.nvmrc` | `24.16.0` | Full pin. **Synced — all groups.** The earlier caveat about dtl-sandbox and nswds-tokens running Node 22 is resolved: every repo in the map is on `24.16.0`. |
| `.npmrc` | `engine-strict=true` | **Synced — all groups.** **nswds-ui takes a variant source** (`repo-files/.npmrc-nswds-ui`), because it needs `provenance=false`: npm only supports provenance for public source repos, and a whole-file sync of the canonical would strand its releases as git tags that never reach npm (as v1.8.0–v2.1.0 were). |

`.gitignore` and `.prettierignore` **also** live in `repo-files/` as a canonical
**base**, but they are NOT clean whole-file syncs — see Mechanism C.

## Mechanism B — shared npm packages (extend, don't copy)

For config that every repo needs but each may extend. Copying a file can't
express "shared base + local override"; an npm package can.

| Package | Replaces | Consumer usage | Home |
|---------|----------|----------------|------|
| `@nswds/eslint-config` | per-repo `eslint.config.mjs` | `export default [...nswds, globalIgnores(['repo-specific/**'])]` | [digitalnsw/nswds-eslint-config](https://github.com/digitalnsw/nswds-eslint-config) |
| `@nswds/prettier-config` | per-repo `.prettierrc` | `"prettier": "@nswds/prettier-config"` in `package.json`, or a `.prettierrc.mjs` that extends it — see below | [digitalnsw/nswds-prettier-config](https://github.com/digitalnsw/nswds-prettier-config) |

The Prettier package has **two consumer shapes**, because the `package.json` key
takes a bare package reference and cannot add options on top. Only base-only
repos can use it — in practice just nswds-tokens. Every Tailwind repo needs the
plugin block and an app-specific `tailwindStylesheet`, so it extends in a
`.prettierrc.mjs` instead:

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

Assign to a variable rather than exporting the object literal: repos lint their
own `.prettierrc.mjs`, and the literal form warns under
`import/no-anonymous-default-export`, which `@nswds/eslint-config` inherits from
`eslint-config-next/core-web-vitals`.

**Both packages have moved out of this repo**, and `packages/` is gone. Neither
could ever be published from here: nswds-devops is `"private": true` at the root
and deliberately comments out `@semantic-release/npm`, so it releases a changelog
and GitHub release but never touches npm. That is why both sat at `0.0.0` with no
adopters — a "single source of truth" that cannot reach a consumer isn't one.

Each now has its own repo mirroring the nswds-tokens release setup:
semantic-release + `@semantic-release/npm` + OIDC trusted publishing, so there is
no `NPM_TOKEN` to rotate or leak. Both publish `access: "public"`, matching
`@nswds/tokens`; `restricted` would have needed a paid npm org plan plus registry
auth in every consumer's CI, which none of them have.

Both carry a CI test that guards their specific silent-failure mode — the ESLint
config lints a real JSX file (the ESLint 10 `getFilename` crash), and the
Prettier config resolves every option through Prettier's own support info (typo'd
keys are ignored rather than rejected).

Both new repos are **MPL-2.0**, matching `@nswds/tokens`, so the whole `@nswds/*`
scope is consistent. The packages previously declared `ISC` — inherited from this
repo's root rather than chosen for a published package. Relicensed before either
was published, so there is no prior distribution under ISC to reconcile.

## Mechanism C — base + repo-specific tail (`.gitignore`, `.prettierignore`)

These have a large common core but every repo legitimately appends its own
build-output/generated-file ignores. There is no "extends" mechanism for ignore
files, and a whole-file sync would delete each repo's tail.

Convention: the synced canonical block sits at the top under a
`# ── Canonical base (synced from nswds-devops) ──` header; repo-specific lines
go **below** a `# repo-specific` header. Because sync is whole-file, we do **not**
add these to the sync map as-is. Options, to decide during rollout:

- **C1 (recommended):** land the base in every repo once (manually or via a
  one-off scripted PR), then keep them honest with a CI check that asserts the
  canonical block is present and unmodified — rather than a destructive sync.
- **C2:** move the common ignores into each repo's `.git/info/exclude` or a
  tool-level ignore that sync owns, leaving the committed `.gitignore` for
  repo-specific entries only.

The canonical base for both is in `repo-files/.gitignore` and
`repo-files/.prettierignore`. The `.gitignore` base normalizes the
`.claude` vs `/.claude` split, folds in the AI-tooling and Snyk-output ignores
several repos already carry, and includes `*.err`.

## Rollout phases

1. **Phase 1 (this PR):** establish the canonical files + packages + this plan
   in nswds-devops. No `sync.yml` change — merging does not touch other repos.
2. **Phase 2 — `.nvmrc` / `.npmrc`: done.** `.nvmrc` was mapped in every group
   during the original rollout, and every repo now reports `24.16.0`, which
   resolved the Node-22 caveat. `.npmrc` is mapped as of this change: 21 repos
   take `repo-files/.npmrc`, and nswds-ui takes `repo-files/.npmrc-nswds-ui`
   so its `provenance=false` survives.

   Adding `engine-strict=true` to the 12 repos that lacked it is safe today —
   every repo's `.nvmrc` (`24.16.0`) satisfies its own declared `engines.node`,
   so nothing that installed before stops installing. It is load-bearing going
   forward: it converts a silently-ignored `engines` warning into a failure in
   the `install / install` job that rulesets already require.
3. **Phase 3 — packages: done.** Both are published and adopted fleet-wide;
   the first-publish/OIDC bootstrap described above is complete, so every merge
   to `main` in either package repo now publishes itself.

   - **`@nswds/eslint-config` (1.0.2)** — adopted by 13 repos. Each dropped its
     local `eslint.config.mjs` body *and* its `@eslint/compat`
     `fixupConfigRules` wrapper; the shim lives in the package. nswds-tokens and
     nswds-ui are the two non-adopters: tokens is not a Next app, and nswds-ui
     extends via its internal `@workspace/eslint-config`.
   - **`@nswds/prettier-config` (1.0.1)** — adopted by all 15 repos. No
     hand-copied `.prettierrc` remains anywhere in the fleet. 13 Tailwind repos
     use the `.prettierrc.mjs` extend form, nswds-tokens uses the `package.json`
     key, and nswds-ui extends through `@workspace/prettier-config`.

   **Zero files were reformatted.** Every repo's `.prettierrc` was already
   byte-identical to the package's `index.json`, so this was pure
   de-duplication. Each migration was gated on two checks: `prettier
   --list-different` identical before and after, and `resolveConfig()` on a
   source file exactly equal to the deleted `.prettierrc`. Note the first check
   is *unchanged*, not *empty* — most repos have a non-empty baseline
   (`CHANGELOG.md`, drizzle metadata, generated token output are not formatted),
   so "empty" would be the wrong pass condition and would have falsely blocked
   correct changes.

   Renovate keeps both packages current from here.
4. **Phase 4 — ignore files:** roll out the `.gitignore` / `.prettierignore`
   base via the chosen Mechanism-C approach.

## Bespoke repos to exclude from convergence

- **nswds-ui** — monorepo; heavily-commented `.prettierignore`, `.npmrc`
  `provenance=false`. Extends packages but keeps its own ignore files.
- **nswds-email-framework** — Maizzle project; its ignores cover Maizzle build
  artifacts, not Next.js. Not a consumer of the Next-based eslint config.
- **ictds-portal-flows** — Power Platform; has no eslint/prettier config at all.
