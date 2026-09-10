# Maintenance and operating model

How the shared tooling is operated day to day, what infrastructure it runs
on, the sanctioned exceptions, and a troubleshooting table of failures that
have actually occurred. The repository inventory is in [FLEET.md](FLEET.md).

## Day-to-day changes

### Changing a script or config

Applies to `scripts/*`, `commit-types.mjs`, `commitlint.config.mjs`,
`git-conventional-commits.yaml`, `release.config.mjs` and `repo-files/*`.

1. Edit here, on a branch, PR into `main`. CI shellchecks the scripts,
   actionlints the workflows, runs the unit tests, and the commit-types-sync
   check keeps the YAML in lockstep with `commit-types.mjs`.
2. On merge, the sync opens a `chore(ci): …` PR in all 28 consumer repos and
   turns on GitHub auto-merge for each one, so they merge themselves as their
   checks go green. Nothing is bypassed: auto-merge waits on the same
   "Protect main" ruleset a human merge waits on, and a repo whose checks go
   red keeps its PR open for you to look at. The review that matters already
   happened on the PR into this repo; the fan-out is a mechanical copy of that
   same diff.
3. Never edit these files in a consumer repo. The next sync overwrites them
   silently.

The one case the fan-out does not arm itself is a change to
`workflow-stubs/`; see the ordering rule under "Changing CI logic".
`Actions → Sync shared files to repos` also takes an `automerge` input
(`auto`, `always`, `never`) to override either way for one run.

Formatting constraint on the `.mjs` configs: the whole fleet formats with
`@nswds/prettier-config` (printWidth 100, no semicolons), including
nswds-ui, whose workspace prettier config extends it. Keep these files in
that style and every consumer's `format:check` stays green.

### Changing CI logic

Applies to `reusable-*.yml` and `.github/scripts/test-mode.mjs` (fetched by
consumers at `@v1`). Merge to `main` as usual; nothing reaches consumers yet,
because stubs pin `@v1`. Ship it with the **Promote v1** workflow
(Actions → Promote v1 → run with the target SHA, or leave the input empty to
promote the newest promotable commit among the last 10 on `main`;
`chore(release): x.y.z [skip ci]` release commits are skipped automatically).
Treat it like a deploy: it changes CI for every repo simultaneously. The
workflow enforces that the target is on `main` with all checks green, records
the previous target in the run summary, and pushes over the release deploy
key because `refs/tags/v*` is ruleset-protected against manual force-push
(ruleset "Protect v tags"). Rollback is re-running the workflow with the
previous SHA from the last promotion's summary. The `v1-promotion`
environment requires a reviewer approval before the job runs.

**The promote-before-fan-out rule is enforced, not remembered.** A stub that
differs from the one `v1` was promoted with would land "new stub + old
reusable" on every consumer, which is a hard error, not a soft skip. The
sync compares `workflow-stubs/` at `main` against `workflow-stubs/` at the
`v1` tag: identical, and it arms auto-merge immediately; different, and it
leaves the fan-out sitting, and Promote v1 arms it as its last step. Order
of operations: merge → wait for the sync run → Promote v1 → the fan-out
merges itself.

A **new** reusable shipped together with a new synced stub has the same
hazard in reverse: the stub reaches consumers while its `@v1` ref still
dangles, so promote `v1` past the commit that added the reusable before the
consumer sync PRs merge, or ship the reusable and promote first and the stub
in a follow-up.

Do not wait for a release commit to promote: Renovate's `chore(deps)` bumps
to the reusables never cut a release, so any green commit on `main`
qualifies. Release commits themselves are `[skip ci]` and carry no check
runs, so the workflow refuses them; promote the merge commit beneath. The
weekly `v1 drift canary` opens a tracking issue when unpromoted
reusable-workflow changes sit on `main` for over a week.

Emergency fallback if the promotion workflow itself is broken: temporarily
disable the tag ruleset's enforcement, push the tag, re-enable. This is the
same enforcement-disable two-step described for `main` in the bypass policy
section.

**Breaking CI change**: do not move `v1`. Tag `v2`, update
`workflow-stubs/*.yml` to `@v2`, merge; the sync delivers the migration to
every repo as a reviewable PR. Repos switch as they merge; `v1` keeps working
for the stragglers.

### Changing the sync map

Applies to `.github/sync.yml`. Group constraints: groups 2a, 2b, 2c and 2d
(nswds-ui, nswds-tokens, the three config packages, nswds-email-design) never
receive `release.yml` or `release.config.mjs`; group 3 (nswds-app) never
receives `release.config.mjs`; group 4 (ictds-portal-flows) never receives
`release.yml` because its `release.yml` is a Power Platform production deploy
pipeline, so the release stub maps to `semantic-release.yml` there. Where a
repo keeps its own `ci.yml` (2b, 2c) the shared merge-gate stub maps to
`shared-ci.yml`; the `install / install` ruleset context is job-based, so
the filename does not matter. Filename collisions are the recurring trap of
this system: before syncing any new workflow stub, check which repos already
have a file by that name.

Never add `deleteOrphaned: true`. Repos keep their own files in `scripts/`
and `.github/workflows/`, and that flag would delete them all.

### Changing Renovate policy

Edit `default.json`, validate with
`npx --package renovate renovate-config-validator default.json`, run
`npm test` (the preset has unit tests in `tools/renovate-preset.test.mjs`),
merge. Renovate reads the preset from `main` at run time; no sync or tag
move. Full guide: [docs/best-practices/renovate.md](docs/best-practices/renovate.md).

### Changing Snyk policy

Edit `snyk-policy/base.snyk`, run `npm test`, merge. The Snyk policy sync
opens one PR per consumer (29 repos including this one) rewriting only the
canonical block above each repo's `# repo-specific` marker. Preview without
opening PRs:

```sh
GH_TOKEN=$(gh auth token) node .github/scripts/snyk-policy.mjs --apply --dry-run
```

Full guide: [snyk-policy/README.md](snyk-policy/README.md).

## Infrastructure

### The sync GitHub App

`nswds-devops-sync` is installed org-wide with Contents RW, Pull requests RW
and Workflows RW. Workflows RW is mandatory: without it every sync PR fails
only on the workflow-stub files. Credentials live as repository secrets on
this repo, `SYNC_APP_ID` and `SYNC_APP_PRIVATE_KEY`. `SYNC_APP_ID` is read
into the token action's `client-id` input; GitHub accepts the numeric App ID
as the JWT issuer just as it does a Client ID. The secrets are
repository-level on purpose: an org-level secret would expose an
org-wide-write key to every repo's workflows. The driver passes the minted
token as `GH_INSTALLATION_TOKEN` (App tokens do not work via `GH_PAT`).

Because the App key equals org-wide write for anyone who can push to this
repo's `main`: keep `main` here protected, and if the org ever gains a repo
the sync must never touch, switch the App installation to selected repos.
Six workflows here mint that App token, so all six act with the key's
org-wide reach:

| Workflow | Uses it to |
|---|---|
| `sync.yml` | write the synced files and open the fan-out PRs in every consumer |
| `snyk-policy-sync.yml` | open the `.snyk` block PRs in every consumer |
| `promote-v1.yml` | arm auto-merge on waiting fan-out PRs after moving `v1` |
| `ccc-pin-drift-canary.yml`, `npm-self-override-canary.yml`, `snyk-policy-canary.yml` | read every consumer's manifests and policy (the three fleet-scanning canaries) |

The other two canaries, `ccc-v10-canary.yml` and `v1-drift-canary.yml`, need
nothing outside this repo and use the repo-scoped `GITHUB_TOKEN`. Any new
workflow that mints the App token widens what a push to `main` here can do
across the org, so add it to this table.

### Reusable workflow access

This repo is **public**. GitHub forbids public repos from calling reusable
workflows in a private one, and nswds-email-issues is public, so the
reusables must be callable from anywhere. If this repo is ever made private,
two things break: set Settings → Actions → General → Access to "Accessible
from repositories owned by the organization" for the private repos, and
nswds-email-issues' CI stops resolving entirely. The test gate also fetches
`.github/scripts/test-mode.mjs` from this repo at `v1` without a token, which
relies on the repo being public.

### Pinned third-party actions

`BetaHuhn/repo-file-sync-action` is pinned to the v1.21.1 commit SHA.
Upstream maintenance has slowed, and an unreviewed update would hold write
access to every repo. If it dies, Redocly maintains a fork of the same
action. Renovate updates the SHA and keeps the version comment.

### AI PR title and description

Both workflows call the Vercel AI Gateway in-house with `curl` (Responses
API, org-level `AI_GATEWAY_API_KEY` secret); no third-party action holds the
key. Defaults: model `openai/gpt-5.6-sol`, provider pinned to `azure`; the
`AI_MODEL` and `AI_PROVIDER` org variables override without a code change
(`AI_PROVIDER=none` removes the pin). If the gateway answers HTTP 402 (out of
credits) the request retries against Azure OpenAI using the org-level
`AZURE_OPENAI_API_KEY` secret and `AZURE_OPENAI_ENDPOINT` variable
(`AZURE_OPENAI_DEPLOYMENT` defaults to `gpt-5.6-sol`). Other failures never
fail over, so misconfiguration stays loud.

### RELEASE_DEPLOY_KEY

Per repo, on every fleet member (every `main` is ruleset-protected). The
release workflow auto-detects the secret and pushes release commits over SSH
as a deploy key that is a bypass actor on the ruleset. To provision one:

```sh
ssh-keygen -t ed25519 -f release-deploy-key -N "" -C "release-bot@<repo>"
gh repo deploy-key add release-deploy-key.pub --repo digitalnsw/<repo> --title "release-bot" --allow-write
gh secret set RELEASE_DEPLOY_KEY --repo digitalnsw/<repo> < release-deploy-key
rm release-deploy-key release-deploy-key.pub
```

then add **Deploy keys** to the ruleset's bypass list. `package.json`
`repository.url` must use the `git+ssh://git@github.com/…` form (or be
absent): semantic-release prefers an `https://` URL there over the SSH
origin, and the push then skips the bypass actor and fails with `GH013`.

### Ruleset bypass policy

The release deploy key is the **only** bypass actor on every fleet ruleset.
Repository admins are deliberately not bypass actors: an admin `git push` to
`main` would skip the required `install / install` gate silently, recreating
the green-but-never-checked failure mode the gates exist to stop. If `main`
must take a push while CI is broken, temporarily set the ruleset's
enforcement to `disabled` (repo Settings → Rules, or
`gh api -X PUT repos/digitalnsw/<repo>/rulesets/<id>` resending the full
definition with `"enforcement": "disabled"`), push, and re-enable: a
deliberate, auditable two-step rather than a standing exemption.
`scripts/push-to-protected-branch.sh` automates exactly that two-step: it
backs up each ruleset definition first, restores from an `EXIT` trap so an
error or `Ctrl-C` still re-enables protection, and keeps the backup and
exits non-zero if a restore fails. Usage is in README.md. When adding a
bypass actor for a new automation, prefer a dedicated deploy key over any
role- or team-based grant.

### Renovate

Mend GitHub App, installed on selected repositories; dependency-update PRs
for every fleet repo. Policy lives in this repo's `default.json` (shared
preset: grouped weekly non-majors, monthly lockfile maintenance, semantic
commits, security PRs left to Snyk, automerge for devDependency patches,
lint/format tooling and lockfile maintenance, and the blocked-update rules
listed in the Renovate guide). Consumers get a synced `renovate.json` that
extends it (source: `repo-files/renovate.json`). Renovate branches
(`renovate/…`) are exempted in `branch-name-config.sh`. This repo's own
`renovate.json` also enables the github-actions manager.
`npm run renovate:dashboard` renders a fleet-wide view of every repo's
Dependency Dashboard into `renovate-fleet-dashboard.html` (gitignored).

### Snyk

The `snyk-io-au` GitHub App is installed org-wide; each repo is imported
into the `digitalnsw` Snyk org from the console and then posts `code/`,
`security/` and `license/snyk (DigitalNSW)` statuses on PR heads. The
canonical `.snyk` policy is owned here (`snyk-policy/`) and delivered by
`snyk-policy-sync.yml`.

### Confluence docs sync

Fleet-wide, opt-in per repo: any repo with a `.github/confluence-sync.yml`
manifest gets the markdown mapped there mirrored to Confluence, one page per
file, on every merge to `main` that touches markdown, the manifest or the
publisher. The pipeline is the synced `confluence-sync.yml` stub →
`reusable-confluence-sync.yml@v1` → `scripts/confluence-sync.sh` (synced),
publishing with [mark](https://github.com/kovetskiy/mark) (pinned by
version and checksum). Repos without a manifest run the stub as a fast
no-op. Confluence is a read-only mirror; each page carries a banner saying
so, and every run republishes every mapped page, so manual Confluence edits
are overwritten on the next markdown merge (or on demand: Actions →
Confluence docs sync → Run workflow). Manifests exist in this repo,
`ictds-portal-flows` and `share`.

Extending the sync is one manifest entry, a file or a directory mapped to a
folder chain in the GDS space:

```yaml
pages:
  - source: docs/best-practices/     # directory → every *.md directly in it
    folders: [Application Support, Development Best Practice]
  - source: ONBOARDING.md            # single file → one page
    folders: [Application Support]
```

Top-level `space:` and `parent:` keys override the defaults (`GDS`, anchored
at the space home page "Tech Enablement and Design"; mark needs that parent
page above the folder chain or folders under the home page read as not
found). mark creates missing folders on first publish. First-time opt-in for
a repo: [ONBOARDING.md](ONBOARDING.md) step 13.

Fragile-by-design behaviour: everything is matched **by title** (page title
= a file's H1), so retitling a file creates a fresh Confluence page and
orphans the old one; page titles are unique per space, so no two synced
files anywhere in the fleet may share an H1 (the script fails on duplicates
within a repo but cannot see other repos' titles); renaming a target folder
or the anchor page in Confluence breaks the sync; deleting a file or
manifest entry never deletes its page; and every publish writes a new page
version even when nothing changed (deliberate: mark's `--changes-only` would
also skip folder moves and let manual edits stick; see the header of
`scripts/confluence-sync.sh`).

Credentials: `CONFLUENCE_USER` and `CONFLUENCE_TOKEN` (Atlassian API token),
org-level secrets scoped to a selected-repositories list, so rotation stays
one edit. Page edits are attributed to that account; move to a service
account if the token owner ever leaves.

### Repo-local automation

None of these sync to consumers. The canaries all run on Monday mornings
(UTC) and report through a single labelled tracking issue rather than a red
job, because a canary that fails every week gets muted.

| Workflow | Schedule | What it does |
|---|---|---|
| `promote-v1.yml` | manual | The only sanctioned way to move `v1`: environment-gated, deploy-key push, records the previous target, arms auto-merge on waiting fan-out PRs |
| `sync.yml` | push to `main` (synced paths), manual | The file-sync driver |
| `snyk-policy-sync.yml` | push to `main` touching `snyk-policy/**` or the script, manual (with `dry_run`) | Fans the canonical Snyk block out as one PR per consumer, preserving each repo's tail byte-for-byte |
| `ccc-v10-canary.yml` | Mondays 08:17 UTC | Probes whether the latest release-notes-generator renders real notes with conventional-changelog-conventionalcommits v10; opens a `ccc-v10-canary` issue the day the Renovate block can be lifted |
| `v1-drift-canary.yml` | Mondays 08:23 UTC | Opens a `v1-drift` issue when unpromoted `reusable-*.yml` changes sit on `main` for over a week |
| `ccc-pin-drift-canary.yml` | Mondays 08:29 UTC | Scans every semantic-release repo for the root `conventional-changelog-conventionalcommits@^9` pin; opens a `ccc-pin-drift` issue on any repo missing it (a missing pin means silently blank release notes) |
| `npm-self-override-canary.yml` | Mondays 08:35 UTC | Scans every repo for a package declared both as a direct dependency and as a literal-pinned `overrides` entry; opens an `npm-self-override` issue (that shape aborts Renovate for the whole repo with no visible error) |
| `snyk-policy-canary.yml` | Mondays 08:44 UTC | Opens or refreshes a `snyk-policy-drift` issue when a consumer's canonical block no longer matches the base, or a repo in `repos.json` is unreadable or unmigrated |

The three fleet-scanning canaries mint the sync-App token because
`GITHUB_TOKEN` is scoped to this repo and cannot read sibling repos. The full
list of workflows that mint it, and why, is under "The sync GitHub App" above.

## Troubleshooting

Every entry is something that has actually happened.

| Symptom | Cause | Fix |
|---|---|---|
| Sync run: `The 'client-id' (or deprecated 'app-id') input must be set` | `SYNC_APP_ID` secret missing or renamed | restore the repo secret |
| Sync run: `could not read Password for 'https://***@github.com'` | App token passed as `GH_PAT` | it must go in `GH_INSTALLATION_TOKEN` |
| Sync run: `ENOENT: .github/sync.yml` | driver has no checkout step | keep `actions/checkout` before the sync action |
| Consumer check: "workflow was not found" | Actions access setting reset, the `v1` tag missing, or a new stub synced before its reusable was promoted | fix the access setting; re-promote via the Promote v1 workflow |
| Consumer PR: "Expected — waiting for status to be reported" forever | a ruleset requires a check by its old single name, or a Snyk context the repo never receives | rename required context to the `job / job` form; for Snyk, drop the context for the single merge and restore it |
| `check-branch-name` red on a repo's first sync PR | base branch lacks the `chore/repo-sync` exemption until that PR merges | expected once; merge past it |
| Promote v1 refuses with "check(s) still running" on a fresh merge commit | the sync fan-out on that commit takes about 10 minutes | re-run once the checks finish |
| Snyk policy sync: `the sync branch's tail has diverged` | the open sync PR and the default branch both changed the repo-owned tail | reconcile by hand (merge or close the open PR, or update its branch), then re-run. Refused on purpose: either side would delete the other's policy |
| Snyk policy sync: `would produce duplicate keys` | an ignore exists in both `snyk-policy/base.snyk` and that repo's `# repo-specific` tail | remove it from whichever side should not own it; YAML takes the last occurrence, so the tail would silently shadow the fleet value |
| Snyk policy canary: a repo reports `manual` | `migrate: "manual"` repos are reported until converted by hand | convert the repo and delete its directive from `snyk-policy/repos.json` |
| Snyk policy sync: `repository ... is not readable` | repo renamed or deleted, or outside the sync App installation | fix the entry in `snyk-policy/repos.json`, or add the repo to the App installation |
| Snyk policy sync: `migrate.tail.from not found` | the anchor line in `snyk-policy/repos.json` no longer exists in that repo's `.snyk` | re-read the repo's file and update the anchor, or set `"tail": "none"` if it is now canonical-shaped |
| Snyk policy canary: a repo reports `unmigrated` | its `.snyk` predates the `# repo-specific` convention and has no migrate directive | add a `migrate` directive for it in `snyk-policy/repos.json`, or mark it `manual` |
| commitlint job: npm `EUSAGE` "can only install with an existing package-lock.json" | lockfile missing **or corrupt** (conflict markers committed inside it); check it parses, do not trust the error text | see ONBOARDING pre-flight (a) |
| `install / install` red on "Unresolved merge conflict markers" | a conflict resolved in the web editor left markers in a tracked file (usually the lockfile) | close the bot PR and let it recreate, or regenerate the lockfile locally |
| `install / install` red on "Literal npm self-override(s)" | a package is both a direct dependency and a literal-pinned `overrides` entry | use the `$`-reference form (`"postcss": "$postcss"`) |
| Snyk license/security red on a lockfile change | Snyk's baseline of main was unparseable, so every pre-existing issue reads as "introduced" | merge the lockfile fix; Snyk re-baselines. MPL-2.0 flags on lightningcss and sharp binaries are accepted in the canonical policy block |
| `check-npm-artifacts` red (nswds-app) | committed `dist/` built before semantic-release bumped the version it inlines | `npm run build:npm` on the branch, commit dist |
| prettier --check red on synced configs | a synced `.mjs` was committed in non-fleet style | format it with `@nswds/prettier-config` (printWidth 100, no semicolons) before merging centrally |
| Push to this repo rejected mid-work | semantic-release pushed a `chore(release): x.y.z [skip ci]` commit after your last fetch | `git pull --rebase`, push again |
| Confluence pages: the "Synced from GitHub" banner renders as a raw code block with a stray `-->` | mark's metadata parser consumes the first non-header line after the `<!-- Key: value -->` block | keep the blank line between the header comments and the Include in `scripts/confluence-sync.sh` |
| commitlint job cancelled at exactly 10m00s, log ending mid-`git fetch` | a content-heavy repo's full-history fetch stalled past the timeout; not a commit-message failure | re-run the job. `reusable-commitlint.yml` fetches with `filter: blob:none` so this needs a stalled network to recur |
| Release run: `GH013` on `git push … https://github.com/<repo>.git` even with `RELEASE_DEPLOY_KEY` set | `package.json` `repository.url` was an `https://` URL, which semantic-release prefers over the SSH origin | use the `git+ssh://git@github.com/…` form in `repository.url` |
| A release ships with an empty changelog body | the repo resolves conventional-changelog-conventionalcommits v10 at the root (the `^9` pin is missing or sits in a workspace instead of the root) | add `conventional-changelog-conventionalcommits@^9` to the root devDependencies; the ccc pin drift canary reports these weekly |
| Renovate goes silent on a repo: no PRs, dashboard checkboxes stay ticked | a literal npm self-override made Renovate abort the whole repository run | convert the override to the `$` form; the npm self-override canary reports these weekly |
| `install / test` green but the suite never ran | the vitest config sits in a workspace and the root has no `test` script; or the root `test` is the npm-init stub | `test-mode.mjs` now scans workspaces; confirm the run log shows a suite executed, and give the root a real `test` script |
| nswds-ui release: git tag exists but npm has no matching version (E422) | provenance enabled on a private source repo | keep `provenance=false` in `.npmrc` while the repo is private (see the exceptions register) |

## Consumer expectations

- Sync PRs are armed for auto-merge; they still wait on every required
  check, and a red one stays open for a human. Review the diff on the PR into
  this repo, not on each fan-out copy.
- A central change fans out as up to 28 PRs. Batch central changes rather
  than merging five small ones in a day.
- The commit vocabulary (`commit-types.mjs`) and branch vocabulary
  (`branch-name-config.sh`) are fleet-wide decisions. Changing them changes
  policy everywhere; announce before merging.
- `release.config.mjs` carries `notesPattern`, which is load-bearing. The
  parser semantic-release bundles accepts a space where the Conventional
  Commits footer requires a colon, so without it any body line beginning
  "breaking changes …" ships a major — that cost engagement v2.0.0 and
  nswds-email v3.0.0. Do not remove it. `tools/release-config.test.mjs`
  pins it by running the real config through the real analyzer.
- `release.config.mjs` also keeps `breakingHeaderPattern`, as a defensive
  fallback only. It was load-bearing when added (a `feat!:` once shipped as
  a minor, @nswds/tokens v2.33.0), but on the current dependency set the
  conventionalcommits preset handles the bang itself and the same test
  passes without it. Keep it for the version that stops doing so. What to
  re-verify on a semantic-release upgrade is that `feat!:` still majors, not
  that this line is what makes it.

## Exceptions register

Sanctioned divergences from the fleet baseline. Anything diverging and NOT
listed here should be treated as drift and converged; known drift is listed
under [FLEET.md open issues](FLEET.md#open-issues).

| Repo | Divergence | Why | Converge when |
|---|---|---|---|
| nswds-ui | Workspace eslint-config package (`@workspace/eslint-config`) instead of `@nswds/eslint-config` | Turborepo needs per-package presets; its `eslint-plugin-react` import lacks the fixup shim, so an eslint major would crash lint. This is the only reason the fleet-wide eslint major block remains | Its workspace base wraps or adopts `@nswds/eslint-config/base`; pair with lifting the Renovate eslint-major block |
| nswds-ui, nswds-email-design | `.npmrc` `provenance=false` via the `repo-files/.npmrc-nswds-ui` variant | npm provenance requires a public source repo. nswds-email-design is private. nswds-ui is now public, so its half of this exception no longer has a cause | See the decision entry below |
| nswds-ui | `packages/ui` `engines.node` is `^22.14.0 \|\| >=24.10.0`, below the fleet floor (the root is on the floor) | Not yet revalidated | Next `packages/ui` engines change |
| nswds-tokens | Bespoke `eslint.config.js` (documented in its file header) | Token pipeline, predates the `./base` entry point | Next config change: adopt `@nswds/eslint-config/base` |
| nswds-email-framework, nswds-email-starter | Tailwind 3 and Maizzle 5; `@maizzle/framework` and `tailwindcss` majors blocked in Renovate for these two repos | Tailwind 4 is incompatible with Maizzle 5. The owner has decided these repos will not migrate to Maizzle 6 | Permanent |
| nswds-ui, nswds-app | `vite`, `vitest` and `@vitest/*` majors blocked in Renovate | `@storybook/addon-vitest` peers do not admit vitest 5 | Storybook ships an addon-vitest release whose vitest peer admits `^5` |
| ictds-portal-flows | `release.yml` is a Power Platform PROD deploy; the release stub maps to `semantic-release.yml` (sync group 4) | Filename collision with a production pipeline | Permanent |
| ictds-portal-flows | PROD deploy approval is the `RELEASE_APPROVERS` allowlist in `release.yml`, not GitHub environment required reviewers | Required reviewers on private repos is Enterprise-only (org is on Team) | Enterprise upgrade or repo visibility change |
| dtl-sandbox | Deploys are manual `pulumi up` from operator machines; `pulumi-preview.yml` (a required `preview` check) is inert until the `PULUMI_PREVIEW_ENABLED` repo variable is set | Azure OIDC federated credential and Pulumi backend variables not yet configured (setup steps are in the workflow header) | OIDC federation lands; then set the variable |
| digitalnsw, images, nswds-email-issues | No ESLint over mirror or static content (digitalnsw lints `api/` and `scripts/` only) | Scraped mirror, static assets, issue tracker | Permanent |
| nswds-devops | No `lint` script and no Prettier config, so `install / lint` and `install / format` self-skip here | Shell and YAML repo; shellcheck and actionlint are the gates | n/a |

## Decisions required

**nswds-ui provenance.** nswds-ui is public, so the `provenance=false`
variant in `.github/sync.yml` group 2a no longer has a cause, and its
releases carry no provenance attestation. Options: move nswds-ui to the
canonical `repo-files/.npmrc` in `sync.yml` (re-enabling provenance, with
a test release to confirm the OIDC publish succeeds), leaving the variant for
nswds-email-design only; or keep the variant and accept unattested
releases. A decision owner has not been assigned.

**Ignore-file convergence.** `.gitignore` and `.prettierignore` have a
canonical base in `repo-files/` but no delivery mechanism; see the open issue
in [docs/config-single-source-of-truth.md](docs/config-single-source-of-truth.md).
