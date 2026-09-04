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
2. On merge, the sync opens a `chore(ci): …` PR in all 24 consumer repos and
   turns on GitHub **auto-merge** for each one, so they merge themselves as
   their checks go green. Nothing is bypassed: auto-merge waits on the same
   "Protect main" ruleset a human merge waits on, and a repo whose checks go
   red keeps its PR open for you to look at. The review that matters already
   happened on the PR into *this* repo — the fan-out is a mechanical copy of
   that same diff.
3. That's it. Never edit these files in a consumer repo — the next sync
   overwrites it silently.

The one case the fan-out does **not** arm itself is a change to
`workflow-stubs/`; see the ordering rule under "Changing CI logic" below.
`Actions → Sync shared files to repos` also takes an `automerge` input
(`auto` / `always` / `never`) if you need to override either way for one run.

One formatting constraint on the `.mjs` configs: the whole fleet now formats
with `@nswds/prettier-config` (printWidth 100, no semicolons) — including
nswds-ui, whose workspace prettier config extends it. Keep these files in
that style and every consumer's `format:check` stays green. (The old
"≤80 columns for nswds-ui" rule is gone: nswds-ui moved to the shared
config on 2026-07-28.)

**Changing CI logic** (`reusable-*.yml`): merge to `main` as usual — nothing
reaches consumers yet, because stubs pin `@v1`. (One exception: a **new**
reusable shipped together with a new synced stub. The sync delivers the stub
to consumers immediately while its `@v1` ref still dangles, so every run of
that stub fails with "workflow was not found" until promotion — promote `v1`
past the commit that added the reusable before consumer sync PRs merge, or
ship the reusable and promote first and the stub in a follow-up.) Ship it with the **Promote
v1** workflow (Actions → Promote v1 → run with the target SHA, or leave the
input empty to promote the newest promotable commit among the last 10 on
main — `chore(release): x.y.z [skip ci]` release commits are skipped
automatically). Treat it
like a deploy — it changes CI for every repo simultaneously. The workflow
machine-enforces what used to be convention here: the target must be on
`main` with all checks green, the previous target is recorded in the run
summary, and the push happens over the release deploy key because
`refs/tags/v*` is ruleset-protected against manual force-push. Rollback =
re-run the workflow with the previous SHA from the last promotion's summary.

**The promote-before-fan-out rule is now enforced, not remembered.** A stub
that differs from the one `v1` was promoted with would land "new stub + old
reusable" on every consumer — a hard error, not a soft skip. So the sync
compares `workflow-stubs/` at `main` against `workflow-stubs/` at the `v1`
tag: identical, and it arms auto-merge immediately; different, and it leaves
the fan-out sitting for you, and **Promote v1 arms it as its last step**. The
condition is deliberately "the stubs we're shipping are the stubs v1
carries", not "this push touched stubs" — the sync amends one long-lived
branch per repo, so a later unrelated sync would otherwise drag an unpromoted
stub in behind it. Order of operations is unchanged; you just no longer have
to hold it in your head: merge → wait for the sync run → Promote v1 → the
fan-out merges itself.

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
`SYNC_APP_ID` and `SYNC_APP_PRIVATE_KEY`. `SYNC_APP_ID` is read into the
action's `client-id` input, not `app-id` — `app-id` is deprecated, and GitHub
accepts the numeric App ID as the JWT issuer just as it does a Client ID, so
the secret's value never had to change. Repository-level on purpose — an
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

The AI PR title/description workflows call the Vercel AI Gateway in-house
with `curl` (Responses API, org-level `AI_GATEWAY_API_KEY` secret) — no
third-party action holds the key. If the gateway answers HTTP 402 (out of
credits) the request retries against Azure OpenAI, when configured via the
org-level `AZURE_OPENAI_API_KEY` secret + `AZURE_OPENAI_ENDPOINT` /
`AZURE_OPENAI_DEPLOYMENT` org variables (v1 surface, deployment default
`gpt-5.6-sol`). Other failures never fail over — misconfiguration stays
loud.

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
deliberate, auditable two-step rather than a standing exemption.
`scripts/push-to-protected-branch.sh` automates exactly that two-step: it
backs up each ruleset definition first, restores from an `EXIT` trap so an
error or `Ctrl-C` still re-enables protection, and keeps the backup and exits
non-zero if a restore fails rather than leaving the branch quietly open. See
"Break-glass: pushing to a protected branch" in README.md for usage. When
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

**Confluence docs sync** (fleet-wide, opt-in per repo): any repo with a
`.github/confluence-sync.yml` manifest gets the markdown mapped there
mirrored to Confluence — one page per file — on every merge to `main` that
touches markdown, the manifest or the publisher. The pipeline is the synced
`confluence-sync.yml` stub → `reusable-confluence-sync.yml@v1` →
`scripts/confluence-sync.sh` (synced), publishing with
[mark](https://github.com/kovetskiy/mark) (pinned by version + checksum).
Repos without a manifest run the stub as a fast no-op, so the stub syncs
everywhere while adoption stays case-by-case. Confluence is a read-only
mirror; each page carries a banner saying so, and every run republishes
every mapped page, so manual Confluence edits are overwritten on the next
markdown merge (or on demand: Actions → Confluence docs sync → Run
workflow).

Extending the sync is one manifest entry — a file or a directory mapped to
a folder chain in the GDS space:

```yaml
pages:
  - source: docs/best-practices/     # directory → every *.md directly in it
    folders: [Application Support, Development Best Practice]
  - source: ONBOARDING.md            # single file → one page
    folders: [Application Support, Fleet Operations]
```

Top-level `space:` / `parent:` keys override the defaults (`GDS`, anchored
at the space home page "Tech Enablement and Design" — mark needs that
Parent *page* above the folder chain or folders under the home page read as
not found). mark creates missing folders on first publish. First-time
opt-in for a repo that has never published: [ONBOARDING.md](ONBOARDING.md)
step 13.

Fragile-by-design bits: everything is matched **by title** (page title = a
file's H1), so retitling a file creates a fresh Confluence page and orphans
the old one; page titles are unique per space, so no two synced files
anywhere in the *fleet* may share an H1 (the script fails on duplicates
within a repo but cannot see other repos' titles); renaming a target folder
— or the anchor page — in Confluence breaks the sync; deleting a file or
manifest entry never deletes its page — clean up by hand; and every publish
writes a new page version even when nothing changed (deliberate: mark's
`--changes-only` would also skip folder moves and let manual edits stick —
see the header of `scripts/confluence-sync.sh`).

Credentials: `CONFLUENCE_USER` / `CONFLUENCE_TOKEN` (Atlassian API token).
This repo carries them as repository secrets; opted-in consumers should get
them as org-level secrets scoped to a selected-repositories list (org
Settings → Secrets and variables → Actions) so rotation stays one edit.
Page edits are attributed to that account — move to a service account if
the token owner ever leaves.

**Repo-local automation** (none of these sync to consumers):

- `promote-v1.yml` — the only sanctioned way to move `v1` (see "Changing CI
  logic" above): environment-gated, deploy-key push, records the previous
  target.
- `v1-drift-canary.yml` — weekly; opens a `v1-drift` issue when unpromoted
  `reusable-*.yml` changes sit on `main` for over a week.
- `ccc-v10-canary.yml` — weekly; probes whether the upstream
  release-notes-generator fix has landed and opens a `ccc-v10-canary` issue
  the day the Renovate ccc block can be lifted.
- `snyk-policy-sync.yml` — fans the canonical Snyk policy block out as one PR
  per consumer when `snyk-policy/` changes. Not part of `.github/sync.yml`:
  `.snyk` is part shared policy, part policy the repo owns, so only the block
  above the `# repo-specific` marker is rewritten and the tail is copied
  through byte-for-byte. Consumers and one-time migrations live in
  `snyk-policy/repos.json`; see `snyk-policy/README.md`.
- `snyk-policy-canary.yml` — weekly; opens a `snyk-policy-drift` issue when a
  consumer's canonical block no longer matches the base. The fan-out only runs
  when the base changes, so nothing else would catch a block edited directly in
  a consumer or a repo added without policy.

## Troubleshooting

Every entry below is something that actually happened (2026-07-15 onward).

| Symptom | Cause | Fix |
|---|---|---|
| Sync run: `The 'client-id' (or deprecated 'app-id') input must be set` (older action versions: `[@octokit/auth-app] appId option is required`) | `SYNC_APP_ID` secret missing/renamed | restore the repo secret |
| Sync run: `could not read Password for 'https://***@github.com'` | App token passed as `GH_PAT` | it must go in `GH_INSTALLATION_TOKEN` |
| Sync run: `ENOENT: .github/sync.yml` | driver has no checkout step | keep `actions/checkout` before the sync action |
| Consumer check: "workflow was not found" | Actions access setting reset, or the `v1` tag missing/deleted | fix the access setting; re-promote via the Promote v1 workflow |
| Consumer PR: "Expected — waiting for status to be reported" forever | a ruleset requires a check by its old single name | rename required context to the `job / job` form (nswds-design's "Protect main" already updated) |
| `check-branch-name` red on a repo's *first* sync PR | base branch lacks the `chore/repo-sync` exemption until that PR merges | expected once; merge past it |
| Snyk policy sync: `migrate.tail.from not found` | the anchor line in `snyk-policy/repos.json` no longer exists in that repo's `.snyk` | re-read the repo's file and update the anchor, or set `"tail": "none"` if it is now canonical-shaped |
| Snyk policy canary: a repo reports `unmigrated` | its `.snyk` predates the `# repo-specific` convention and has no migrate directive | add a `migrate` directive for it in `snyk-policy/repos.json`, or mark it `manual` |
| commitlint job: npm `EUSAGE` "can only install with an existing package-lock.json" | lockfile missing **or corrupt** — check it parses, don't trust the error text | see ONBOARDING pre-flight (a); nswds-public-sans had conflict markers committed inside it |
| Snyk license/security red on a lockfile change | Snyk's baseline of main was unparseable, so every pre-existing issue reads as "introduced" | merge the lockfile fix; Snyk re-baselines. MPL-2.0 flags on lightningcss binaries come via @nswds/app in every repo — org license-policy call, not a repo bug |
| `check-npm-artifacts` red (nswds-app) | committed `dist/` built before semantic-release bumped the version it inlines | `npm run build:npm` on the branch, commit dist |
| prettier --check red on synced configs | a synced `.mjs` was committed in non-fleet style | format it with `@nswds/prettier-config` (printWidth 100, no semicolons) before merging centrally |
| Push to this repo rejected mid-work | semantic-release pushed a `chore(release): x.y.z [skip ci]` commit after your last fetch | `git pull --rebase`, push again — routine |
| Confluence pages: the "Synced from GitHub" banner renders as a raw code block with a stray `-->` | mark's metadata parser consumes the first non-header line after the `<!-- Key: value -->` block; the multi-line `ac:box` Include sat directly against the headers, so its opening line was eaten and the rest rendered as indented code | keep the blank line between the header comments and the Include in `scripts/confluence-sync.sh` (fixed 2026-07-19; verified against mark 16.5.1 with `--compile-only`) |
| commitlint job cancelled at exactly 10m00s, log ending mid-`git fetch` with no commitlint output | `actions/checkout` was fetching all history *and* all file content; on a content-heavy consumer (nswds-email-framework carries ~3.5k generated HTML files) that transfer stalled past `timeout-minutes: 10`, so the job died before linting anything. Not a commit-message failure — check whether the same commits passed an earlier run | re-run the job to unblock the PR; `reusable-commitlint.yml` now fetches with `filter: blob:none` (2026-08-03), so it pulls commit metadata rather than every historical revision of every file |
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
