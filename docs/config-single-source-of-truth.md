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
| `.nvmrc` | `24.16.0` | Full pin. **dtl-sandbox** and **nswds-tokens** currently run Node 22 — verify their build/CI on 24 before adding them to the sync group. |
| `.npmrc` | `engine-strict=true` | **nswds-ui** additionally needs `provenance=false` (private-publish workaround). Its sync group gets a variant source, or it keeps that line as a repo-specific override. |

`.gitignore` and `.prettierignore` **also** live in `repo-files/` as a canonical
**base**, but they are NOT clean whole-file syncs — see Mechanism C.

## Mechanism B — shared npm packages (extend, don't copy)

For config that every repo needs but each may extend. Copying a file can't
express "shared base + local override"; an npm package can.

| Package | Replaces | Consumer usage | Home |
|---------|----------|----------------|------|
| `@nswds/eslint-config` | per-repo `eslint.config.mjs` | `export default [...nswds, globalIgnores([...repo-specific])]` | [digitalnsw/nswds-eslint-config](https://github.com/digitalnsw/nswds-eslint-config) |
| `@nswds/prettier-config` | per-repo `.prettierrc` | `"prettier": "@nswds/prettier-config"` in `package.json` | `packages/` here |

`@nswds/eslint-config` **has moved out of this repo** into
[digitalnsw/nswds-eslint-config](https://github.com/digitalnsw/nswds-eslint-config).
It could never be published from here: nswds-devops is `"private": true` at the
root and deliberately comments out `@semantic-release/npm`, so it releases a
changelog and GitHub release but never touches npm. That is why the package sat
at `0.0.0` with zero adopters while all 12 Next.js repos kept hand-maintaining
their own `eslint.config.mjs`. Its own repo mirrors the nswds-tokens release
setup — semantic-release + `@semantic-release/npm` + OIDC trusted publishing, so
there is no `NPM_TOKEN` to rotate.

`@nswds/prettier-config` still lives in `packages/` and is still unpublishable
for the same reason. It needs the same extraction before Phase 3 can complete.
3. A deliberate license decision: the packages currently declare `ISC` to match
   the repo root, but the repo has no `LICENSE` file. Before publishing, confirm
   the intended license for `@nswds/*` and add a `LICENSE` file accordingly.

Until then the packages are the reviewed source of truth but not installable.

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
2. **Phase 2 — `.nvmrc` / `.npmrc`:** verify the two Node-22 repos, then add
   `repo-files/.nvmrc` and `repo-files/.npmrc` to the sync map (handling the
   nswds-ui `.npmrc` variant). Merging fans out `chore(ci):` PRs.
3. **Phase 3 — packages:** `@nswds/eslint-config` is extracted to its own repo
   with publishing wired up; it needs a one-time manual first publish before
   OIDC trusted publishing can take over (npm cannot bind a trusted publisher to
   a package name that has never been published). `@nswds/prettier-config` still
   needs the same extraction. Then migrate repos one group at a time — each
   adopting repo drops its local `eslint.config.mjs` body *and* the
   `@eslint/compat` `fixupConfigRules` wrapper, since the shim now lives inside
   the package. Renovate keeps them current after.
4. **Phase 4 — ignore files:** roll out the `.gitignore` / `.prettierignore`
   base via the chosen Mechanism-C approach.

## Bespoke repos to exclude from convergence

- **nswds-ui** — monorepo; heavily-commented `.prettierignore`, `.npmrc`
  `provenance=false`. Extends packages but keeps its own ignore files.
- **nswds-email-framework** — Maizzle project; its ignores cover Maizzle build
  artifacts, not Next.js. Not a consumer of the Next-based eslint config.
- **ictds-portal-flows** — Power Platform; has no eslint/prettier config at all.
