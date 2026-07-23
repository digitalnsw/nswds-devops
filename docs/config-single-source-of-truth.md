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

| Package | Replaces | Consumer usage |
|---------|----------|----------------|
| `@nswds/eslint-config` | per-repo `eslint.config.mjs` | `export default [...nswds, globalIgnores([...repo-specific])]` |
| `@nswds/prettier-config` | per-repo `.prettierrc` | `"prettier": "@nswds/prettier-config"` in `package.json` |

Both live in `packages/` here. **Publishing is not yet wired up** — nswds-devops
is private and has `@semantic-release/npm` disabled. Enabling it needs:

1. An npm org/scope (`@nswds`) publish token as a repo secret, and
2. A release/publish path for `packages/*` (workspaces + `@semantic-release/npm`,
   or a dedicated publish workflow).
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
3. **Phase 3 — packages:** wire up publishing, publish `@nswds/eslint-config`
   and `@nswds/prettier-config`, then migrate repos one group at a time
   (Renovate keeps them current after).
4. **Phase 4 — ignore files:** roll out the `.gitignore` / `.prettierignore`
   base via the chosen Mechanism-C approach.

## Bespoke repos to exclude from convergence

- **nswds-ui** — monorepo; heavily-commented `.prettierignore`, `.npmrc`
  `provenance=false`. Extends packages but keeps its own ignore files.
- **nswds-email-framework** — Maizzle project; its ignores cover Maizzle build
  artifacts, not Next.js. Not a consumer of the Next-based eslint config.
- **ictds-portal-flows** — Power Platform; has no eslint/prettier config at all.
