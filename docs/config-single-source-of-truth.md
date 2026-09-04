# Config single source of truth

Six config files had drifted across the fleet with no canonical version:
`.nvmrc`, `.npmrc`, `.gitignore`, `eslint.config.mjs`, `.prettierrc`,
`.prettierignore`. This establishes one source of truth for each and a rollout
plan to converge the fleet (24 consumer repos) onto it.

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
repos can use it — nswds-tokens and the two config packages. Every Tailwind repo needs the
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

## Mechanism C — base + repo-specific tail (`.gitignore`, `.prettierignore`, `.snyk`)

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

### `.snyk` — Mechanism C, resolved as a block sync (C3)

`.snyk` is a Mechanism C file for the same reason as the ignore files, and it
is the one where the choice has actually been made. The C1/C2 options above
were never rolled out, and the cost showed: the same policy change had to be
written by hand in four repos on 2026-08-31, and only three repos ever received
the enumerated licence list at all.

**The mechanism.** The canonical block lives in
[`snyk-policy/base.snyk`](../snyk-policy/base.snyk) and ends with a
`  # repo-specific` marker. `.github/scripts/snyk-policy.mjs` rewrites
everything down to and including that marker and copies the tail through
byte-for-byte — it never parses, reorders or reformats the tail, so a repo
cannot lose policy it owns. Delivery is one PR per repo on a
`chore/repo-sync/snyk-policy` branch, driven by
`.github/workflows/snyk-policy-sync.yml` when the base changes, with
`.github/workflows/snyk-policy-canary.yml` probing weekly for drift the
fan-out would not otherwise notice.

This is why `.snyk` is still absent from `.github/sync.yml`: the constraint
that ruled out a whole-file sync has not gone away. The block sync is a
different mechanism, not an exception to it.

**Consumers and one-time migrations** are declared in
[`snyk-policy/repos.json`](../snyk-policy/repos.json). A repo written before
the convention existed carries a `migrate` directive saying how to derive its
tail once; the directive is inert afterwards and should be deleted. A directive
**wins over** an existing marker, because several repos put the marker in the
wrong place — reviewers and nswds-email had it above their licence list, and
trusting it there emits those 28 keys twice.

**What the base contains, as of 2026-09-04.** Twenty-eight enumerated licence
acceptances and no vulnerability ignores:

- **Licence acceptances** — weak-copyleft (MPL-2.0 / LGPL-3.0) and permissive
  (Artistic-2.0) findings on unmodified, transitively-installed build and
  runtime libraries: the sharp/libvips platform binaries via next, the
  lightningcss platform binaries via Tailwind, axe-core, npm bundled inside
  semantic-release, and our own `@nswds/*` packages. Reviewers, attestation and
  engagement already carried this list, byte-identical; it is now the base.
  Repos that lacked it were failing those findings — nswds-design reported 12
  live licence findings with a policy that ignored only dead entries.
- **No `'*:lic:*'` catch-all, ever.** Snyk matches ignore keys as exact issue
  IDs and does not support globs, so a catch-all is dead config that reads as
  protection. Four repos carried one; the enumerated list replaces it.
- **The two nanoid CWE-835 ignores are gone.** They are obsolete, not expired.
  Every repo in the fleet now resolves nanoid to 3.3.18 (nswds-app also has a
  direct 6.0.1), Snyk has corrected the affected range, and a scan of
  nswds-design with `--ignore-policy` reports zero nanoid findings. Attestation
  and engagement removed them on 2026-08-31 on that evidence. Do not re-add
  them speculatively — if either advisory returns it should be re-triaged on
  the evidence at that time.

**Genuinely repo-owned policy that the tail preserves**: nswds-email-framework
excludes its generated `docs/` and `build_local/` from Snyk Code (~7,000 files;
without it a root scan times out), nswds-tokens accepts a `javascript/PT`
finding in one developer script, nswds-app accepts two transitive postcss
advisories, and dtl-sandbox path-scopes js-yaml and the npm bundle. An earlier
version of this document attributed the Snyk Code exclude to nswds-ui; that was
wrong — nswds-ui carried only the obsolete nanoid entries.

dtl-sandbox is marked `manual`: its path-scoping rationale is top-of-file prose
sitting above `ignore:`, which the canonical block now owns, and re-homing it
into the tail is a judgement call rather than a mechanical move.

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
   base via the chosen Mechanism-C approach. Still open. The `.snyk` block sync
   (Phase 5) is the worked example to copy: same base + marker + preserved tail
   shape, same fan-out and canary, and it needs no new machinery to reuse.
5. **Phase 5 — `.snyk`: mechanism done, first fan-out pending.** `snyk-policy/`
   holds the base and the consumer map, `.github/scripts/snyk-policy.mjs`
   renders and delivers it, and the sync + canary workflows are wired. Twelve
   repos are queued for their first PR (three drift-only, nine one-time
   migrations); dtl-sandbox is marked `manual`. The superseded
   `repo-files/.snyk` has been removed — it was never in the sync map and its
   two nanoid ignores are obsolete, so leaving it would have offered a second,
   stale "canonical" file.

## Bespoke repos to exclude from convergence

- **nswds-ui** — monorepo; heavily-commented `.prettierignore`, `.npmrc`
  `provenance=false`. Extends packages but keeps its own ignore files.
- **nswds-email-framework** — Maizzle project; its ignores cover Maizzle build
  artifacts, not Next.js. Not a consumer of the Next-based eslint config.
- **ictds-portal-flows** — Power Platform; has no eslint/prettier config at all.
