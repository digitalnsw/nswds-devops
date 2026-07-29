# Maintenance & operating model

This is the handover doc. Everything in here comes from actually running the
system, including the initial 17-repo rollout on 2026-07-15 — the
troubleshooting section is a list of things that really broke, in the order
they broke.

## Day-to-day changes

**Changing a script or config** (`scripts/*`, `commit-types.mjs`,
`commitlint.config.mjs`, `git-conventional-commits.yaml`,
`release.config.mjs`):

1. Edit here, on a branch, PR into `main`. CI shellchecks the scripts and
   actionlints the workflows; the commit-types-sync check keeps the YAML in
   lockstep with `commit-types.mjs`.
2. On merge, the sync opens a `chore(ci): …` PR in all 24 consumer repos. They merge
   on their own schedule; until they do they just run the previous version.
3. That's it. Never edit these files in a consumer repo — the next sync
   overwrites it silently.

One formatting constraint on the `.mjs` configs: the whole fleet now formats
with `@nswds/prettier-config` (printWidth 100, no semicolons) — including
nswds-ui, whose workspace prettier config extends it. Keep these files in
that style and every consumer's `format:check` stays green. (The old
"≤80 columns for nswds-ui" rule is gone: nswds-ui moved to the shared
config on 2026-07-28.)

**Changing CI logic** (`reusable-*.yml`): merge to `main` as usual — nothing
reaches consumers yet, because stubs pin `@v1`. Ship it with the **Promote
v1** workflow (Actions → Promote v1 → run with the target SHA). Treat it
like a deploy — it changes CI for every repo simultaneously. The workflow
machine-enforces what used to be convention here: the target must be on
`main` with all checks green, the previous target is recorded in the run
summary, and the push happens over the release deploy key because
`refs/tags/v*` is ruleset-protected against manual force-push. Rollback =
re-run the workflow with the previous SHA from the last promotion's summary.

Don't wait for a release commit to promote: Renovate's `chore(deps)` bumps
to the reusables never cut a release, so any green commit on `main`
qualifies. Release commits themselves are `[skip ci]` and carry **no check
runs**, so the workflow refuses them — promote the merge commit beneath (a
release commit only adds CHANGELOG/version on top of it). The **v1 drift
canary** (weekly) opens a tracking issue when unpromoted reusable-workflow
changes sit on `main` for over a week.

Emergency fallback if the promotion workflow itself is broken: temporarily
disable the tag ruleset's enforcement, push the tag, re-enable — the same
enforcement-disable two-step described for `main` in the bypass policy
section below.

**Breaking CI change**: don't move v1. Tag `v2`, update
`workflow-stubs/*.yml` to `@v2`, merge — the sync delivers the migration to
every repo as a reviewable PR. Repos switch as they merge; v1 keeps working
for the stragglers. (The @main → @v1 migration ran exactly this way across
all 17 repos and was uneventful.)

**Changing the sync map** (`.github/sync.yml`): remember the group
constraints — groups 2a/2b (nswds-ui, nswds-tokens) never receive
`release.yml` or `release.config.mjs`; group 3 (nswds-app) never receives
`release.config.mjs`; group 4 (ictds-portal-flows) never receives
`release.yml` **because its release.yml is a Power Platform production
deploy pipeline** — the release stub maps to `semantic-release.yml` there.
Also: nswds-tokens' `.github/workflows/ci.yml` is its own lint/test/typecheck
pipeline — the shared merge-gate stub maps to `shared-ci.yml` there (the
`install / install` ruleset context is job-based, so the filename doesn't
matter). Filename collisions are the recurring trap of this system: before
syncing any new workflow stub, check which repos already have a file by that
name.
And never, under any circumstances, add `deleteOrphaned: true` — repos keep
their own files in `scripts/` and `.github/workflows/`, and that flag would
delete them all.

## Infrastructure

**The sync GitHub App** (`nswds-devops-sync`): installed org-wide with
Contents RW, Pull requests RW, and Workflows RW (the last one is mandatory —
without it every sync PR fails only on the workflow-stub files, which is
confusing to debug). Credentials live as repository secrets on this repo:
`SYNC_APP_ID` and `SYNC_APP_PRIVATE_KEY`. Repository-level on purpose — an
org-level secret would expose an org-wide-write key to every repo's
workflows. The driver passes the minted token as `GH_INSTALLATION_TOKEN`
(App tokens don't work via `GH_PAT`; that input is for personal tokens).

Because the App key equals org-wide write for anyone who can push to this
repo's `main`: keep `main` here protected, and if the org ever gains a repo
the sync must never touch, switch the App installation to selected repos.

**Reusable workflow access**: this repo is **public** (made so 2026-07-15 —
GitHub forbids public repos from calling reusable workflows in a private
one, and nswds-email-issues is public), which makes the reusables callable
from anywhere with no access setting. If it's ever made private again, two
things break: set Settings → Actions → General → Access to "Accessible from
repositories owned by the organization" for the private repos, and
nswds-email-issues' CI stops resolving entirely.

**Pinned third-party actions** (deliberate, don't unpin):

- `BetaHuhn/repo-file-sync-action` pinned to the v1.21.1 commit SHA —
  upstream maintenance has slowed, and an unreviewed update would hold write
  access to every repo. If it dies, Redocly maintains a fork of the same
  action.
- `platisd/openai-pr-description` pinned to a commit SHA — it runs with
  `OPENAI_API_KEY` in every repo; `@master` would let upstream changes run
  unreviewed.

**RELEASE_DEPLOY_KEY** (per-repo, only where `main` is ruleset-protected;
as of 2026-07-16 that is every repo on the sync — the "Protect main"
ruleset requires `commitlint / commitlint` + `install / install` from the
synced ci.yml stub): the release workflow auto-detects the secret
and pushes release commits over SSH as a deploy key that's a bypass actor on
the ruleset. To provision one:

```sh
ssh-keygen -t ed25519 -f release-deploy-key -N "" -C "release-bot@<repo>"
gh repo deploy-key add release-deploy-key.pub --repo digitalnsw/<repo> --title "release-bot" --allow-write
gh secret set RELEASE_DEPLOY_KEY --repo digitalnsw/<repo> < release-deploy-key
rm release-deploy-key release-deploy-key.pub
```

then add **Deploy keys** to the ruleset's bypass list.

**Ruleset bypass policy**: the release deploy key is the ONLY bypass actor
on every fleet ruleset. Repository admins are deliberately not bypass
actors — an admin `git push` to `main` would skip the required
`install / install` gate silently, recreating the exact
green-but-never-checked failure mode the gates exist to stop (the fleet
rollout originally granted admins an always-on bypass; it was removed
2026-07-29 after a direct push demonstrated the hole in practice). If
`main` must take a push while CI is broken, temporarily set the ruleset's
enforcement to `disabled` (repo Settings → Rules, or
`gh api -X PUT repos/digitalnsw/<repo>/rulesets/<id>` resending the full
definition with `"enforcement": "disabled"`), push, and re-enable — a
deliberate, auditable two-step rather than a standing exemption. When
adding a bypass actor for a new automation, prefer a dedicated deploy key
over any role- or team-based grant.

**Renovate** (Mend GitHub App — full guide:
[docs/best-practices/renovate.md](docs/best-practices/renovate.md)):
dependency-update PRs for every repo.
Policy lives in this repo's `default.json` (shared preset — grouped weekly
non-majors, monthly lockfile maintenance, semantic commits, security PRs
left to Snyk); consumers get a synced `renovate.json` that extends it
(source: `repo-files/renovate.json`). Preset changes apply on Renovate's
next run — no sync needed; the synced file only changes if the `extends`
pointer itself changes. Renovate branches (`renovate/…`) are exempted in
`branch-name-config.sh` alongside dependabot's. This repo's own
`renovate.json` also enables the github-actions manager.

**Confluence docs sync**: every merge to `main` that touches
`docs/best-practices/**` republishes the guides to Confluence — one page per
file under GDS → Application Support → **Development Best Practice**
(`confluence-sync.yml` → `.github/scripts/confluence-sync.sh`, using
[mark](https://github.com/kovetskiy/mark), pinned by version + checksum).
Confluence is a read-only mirror; each page carries a banner saying so.
Fragile-by-design bits: everything is matched **by title** (page title = a
guide's H1), so retitling a guide creates a fresh Confluence page and
orphans the old one; renaming either folder — or the space home page
"Tech Enablement and Design", which mark needs as the anchor *page* above
the folder chain — breaks the sync; and deleting a guide never deletes its
page — clean up by hand. Credentials
are repository secrets `CONFLUENCE_USER` / `CONFLUENCE_TOKEN` (Atlassian API
token); page edits are attributed to that account, so move to a service
account if the token owner ever leaves.

**Repo-local automation** (none of these sync to consumers):

- `promote-v1.yml` — the only sanctioned way to move `v1` (see "Changing CI
  logic" above): environment-gated, deploy-key push, records the previous
  target.
- `v1-drift-canary.yml` — weekly; opens a `v1-drift` issue when unpromoted
  `reusable-*.yml` changes sit on `main` for over a week.
- `ccc-v10-canary.yml` — weekly; probes whether the upstream
  release-notes-generator fix has landed and opens a `ccc-v10-canary` issue
  the day the Renovate ccc block can be lifted.
- `confluence-sync.yml` — mirrors `docs/best-practices/` to Confluence
  (title-matched pages; retitling a guide orphans its page).

## Troubleshooting

Every entry below is something that actually happened (2026-07-15 onward).

| Symptom | Cause | Fix |
|---|---|---|
| Sync run: `[@octokit/auth-app] appId option is required` | `SYNC_APP_ID` secret missing/renamed | restore the repo secret |
| Sync run: `could not read Password for 'https://***@github.com'` | App token passed as `GH_PAT` | it must go in `GH_INSTALLATION_TOKEN` |
| Sync run: `ENOENT: .github/sync.yml` | driver has no checkout step | keep `actions/checkout` before the sync action |
| Consumer check: "workflow was not found" | Actions access setting reset, or the `v1` tag missing/deleted | fix the access setting; re-promote via the Promote v1 workflow |
| Consumer PR: "Expected — waiting for status to be reported" forever | a ruleset requires a check by its old single name | rename required context to the `job / job` form (nswds-design's "Protect main" already updated) |
| `check-branch-name` red on a repo's *first* sync PR | base branch lacks the `chore/repo-sync` exemption until that PR merges | expected once; merge past it |
| commitlint job: npm `EUSAGE` "can only install with an existing package-lock.json" | lockfile missing **or corrupt** — check it parses, don't trust the error text | see ONBOARDING pre-flight (a); nswds-public-sans had conflict markers committed inside it |
| Renovate "lock file maintenance" PR red on `install / install` (and commitlint) with `npm ci … not in sync` | from-scratch lockfile regeneration hits an npm peer-nesting bug: `@conventional-changelog/git-client@3` peers need `conventional-commits-filter@^6` while semantic-release's stack needs `^5`; regen hoists 5.0.0 and nests nothing (incremental Renovate updates resolve the same tree correctly) | close the PR (nswds-email#454 has the full write-up); retry from the Dependency Dashboard after the commitlint/semantic-release stacks re-align |
| Snyk license/security red on a lockfile change | Snyk's baseline of main was unparseable, so every pre-existing issue reads as "introduced" | merge the lockfile fix; Snyk re-baselines. MPL-2.0 flags on lightningcss binaries come via @nswds/app in every repo — org license-policy call, not a repo bug |
| `check-npm-artifacts` red (nswds-app) | committed `dist/` built before semantic-release bumped the version it inlines | `npm run build:npm` on the branch, commit dist |
| prettier --check red on synced configs | a synced `.mjs` was committed in non-fleet style | format it with `@nswds/prettier-config` (printWidth 100, no semicolons) before merging centrally |
| Push to this repo rejected mid-work | semantic-release pushed a `chore(release): x.y.z [skip ci]` commit after your last fetch | `git pull --rebase`, push again — routine |
| Confluence pages: the "Synced from GitHub" banner renders as a raw code block with a stray `-->` | mark's metadata parser consumes the first non-header line after the `<!-- Key: value -->` block; the multi-line `ac:box` Include sat directly against the headers, so its opening line was eaten and the rest rendered as indented code | keep the blank line between the header comments and the Include in `confluence-sync.sh` (fixed 2026-07-19; verified against mark 16.5.1 with `--compile-only`) |
| Release run: `GH013` on `git push … https://github.com/<repo>.git` even with `RELEASE_DEPLOY_KEY` set | `package.json` `repository.url` was an `https://` URL — semantic-release prefers it over the SSH origin the deploy-key checkout configures, so the push skips the bypass actor | use the `git+ssh://git@github.com/…` form in `repository.url` (fixed here 2026-07-17; consumer sweep same day found nswds-tokens as the only other exposure — fixed via tokens #127; the rest have no `repository` field and fall back to the SSH origin) |

## Consumer expectations (the social contract)

- Sync PRs are reviewed and merged by each repo's owners like any other PR;
  nothing lands unreviewed. Don't enable auto-merge on repo-sync PRs unless
  drift has been zero for a good while.
- A central change fans out as up-to-17 PRs. Batch central changes rather
  than merging five small ones in a day, or the fleet drowns in sync PRs.
- The commit vocabulary (`commit-types.mjs`) and branch vocabulary
  (`branch-name-config.sh`) are fleet-wide decisions. Changing them changes
  policy everywhere; announce before merging.

## Exceptions register

Sanctioned divergences from the fleet baseline. Anything diverging and NOT
listed here should be treated as drift and converged.

| Repo | Divergence | Why | Converge when |
|---|---|---|---|
| nswds-ui | Workspace eslint-config package (ESLint ^9, only-warn + per-app `--max-warnings 0`) instead of `@nswds/eslint-config` | Turborepo needs per-package presets; its `eslint-plugin-react` import lacks the fixup shim, so an eslint major would crash lint | Its workspace base wraps or adopts `@nswds/eslint-config/base`; pair with lifting the Renovate eslint-major block |
| nswds-tokens | Bespoke `eslint.config.js` (documented in its file header) | Token pipeline, predates the `./base` entry point | Next config change — adopt `@nswds/eslint-config/base` |
| nswds-ui | `engines` `^22.14.0 \|\| >=24.10.0`, `.npmrc` `provenance=false` | Documented in `.npmrc-nswds-ui` (private-repo npm E422) | Repo goes public / engines revalidated |
| ictds-portal-flows | `release.yml` is a Power Platform PROD deploy; the release stub maps to `semantic-release.yml` (sync group 4) | Filename collision with a production pipeline | n/a — permanent |
| ictds-portal-flows | PROD deploy approval is the `RELEASE_APPROVERS` allowlist in `release.yml`, not GitHub environment required reviewers | Required reviewers on private repos is Enterprise-only (org is on Team) | Enterprise upgrade or repo visibility change |
| dtl-sandbox | Deploys are manual `pulumi up` from operator machines; CI gates are typecheck + lint only | Sandbox stack; `pulumi preview` on PRs via Azure OIDC is planned, pending federated-credential setup | OIDC federation lands |
| digitalnsw, images, nswds-email-issues | No ESLint over mirror/static content (digitalnsw lints `api/` + `scripts/` only) | Scraped mirror / static assets / issue tracker — nothing meaningful to lint | n/a |

## History / decision notes

- Consolidated 2026-07-15 from copy-pasted files that had drifted into 3–4
  variants per file. Canonical = the newest lineage plus improvements folded
  back in from stragglers (bot-commit commitlint ignores from nswds-tokens
  and ictds-portal-flows, GitHub API retries from attestation, deploy-key
  release push from nswds-design, HUSKY=0 + release concurrency from
  nswds-tokens).
- File-sync + reusable workflows was chosen over an npm package: reviewable
  per-repo diffs for content, instant tag-based rollout/rollback for CI.
- `release.config.mjs` keeps `breakingHeaderPattern` for a reason — without
  it semantic-release treats `feat!:` as a minor bump (shipped a breaking
  change as v2.33.0 in @nswds/tokens once). Comment in the file; don't
  remove it when upgrading semantic-release without re-verifying.
