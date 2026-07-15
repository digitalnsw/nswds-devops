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
2. On merge, the sync opens a `chore(ci): …` PR in all 17 repos. They merge
   on their own schedule; until they do they just run the previous version.
3. That's it. Never edit these files in a consumer repo — the next sync
   overwrites it silently.

Two formatting constraints on the `.mjs` configs, learned the hard way:
nswds-ui runs `prettier --check` in CI with printWidth 80 / no semicolons,
while other repos use printWidth 100. Keep every line in these files ≤80
columns and semicolon-free and the same bytes satisfy both configs. If you
add a long expression, restructure it (block body, extracted variable)
rather than letting prettier wrap it — an 80-wrapped line gets *unwrapped*
by a width-100 config and then fails the other check.

**Changing CI logic** (`reusable-*.yml`): merge to `main` as usual — nothing
reaches consumers yet, because stubs pin `@v1`. Ship it by moving the tag:

```sh
git fetch --tags
git tag -f v1 <commit>        # normally the latest release commit
git push -f origin v1
```

Rules for moving v1: central CI must be green on that commit, and treat it
like a deploy — it changes CI for every repo simultaneously. Rollback is the
same command pointed at the previous commit (tags before the move:
`git rev-parse v1` and note it down).

**Breaking CI change**: don't move v1. Tag `v2`, update
`workflow-stubs/*.yml` to `@v2`, merge — the sync delivers the migration to
every repo as a reviewable PR. Repos switch as they merge; v1 keeps working
for the stragglers. (The @main → @v1 migration ran exactly this way across
all 17 repos and was uneventful.)

**Changing the sync map** (`.github/sync.yml`): remember the group
constraints — group 2 (nswds-ui, nswds-tokens) never receives `release.yml`
or `release.config.mjs`; group 3 (nswds-app) never receives
`release.config.mjs`; group 4 (ictds-portal-flows) never receives
`release.yml` **because its release.yml is a Power Platform production
deploy pipeline** — the release stub maps to `semantic-release.yml` there.
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
currently just nswds-design): the release workflow auto-detects the secret
and pushes release commits over SSH as a deploy key that's a bypass actor on
the ruleset. To provision one:

```sh
ssh-keygen -t ed25519 -f release-deploy-key -N "" -C "release-bot@<repo>"
gh repo deploy-key add release-deploy-key.pub --repo digitalnsw/<repo> --title "release-bot" --allow-write
gh secret set RELEASE_DEPLOY_KEY --repo digitalnsw/<repo> < release-deploy-key
rm release-deploy-key release-deploy-key.pub
```

then add **Deploy keys** to the ruleset's bypass list.

## Troubleshooting

Every entry below is something that actually happened on 2026-07-15.

| Symptom | Cause | Fix |
|---|---|---|
| Sync run: `[@octokit/auth-app] appId option is required` | `SYNC_APP_ID` secret missing/renamed | restore the repo secret |
| Sync run: `could not read Password for 'https://***@github.com'` | App token passed as `GH_PAT` | it must go in `GH_INSTALLATION_TOKEN` |
| Sync run: `ENOENT: .github/sync.yml` | driver has no checkout step | keep `actions/checkout` before the sync action |
| Consumer check: "workflow was not found" | Actions access setting reset, or the `v1` tag missing/deleted | fix the access setting; re-push the tag |
| Consumer PR: "Expected — waiting for status to be reported" forever | a ruleset requires a check by its old single name | rename required context to the `job / job` form (nswds-design's "Protect main" already updated) |
| `check-branch-name` red on a repo's *first* sync PR | base branch lacks the `chore/repo-sync` exemption until that PR merges | expected once; merge past it |
| commitlint job: npm `EUSAGE` "can only install with an existing package-lock.json" | lockfile missing **or corrupt** — check it parses, don't trust the error text | see ONBOARDING pre-flight (a); nswds-public-sans had conflict markers committed inside it |
| Snyk license/security red on a lockfile change | Snyk's baseline of main was unparseable, so every pre-existing issue reads as "introduced" | merge the lockfile fix; Snyk re-baselines. MPL-2.0 flags on lightningcss binaries come via @nswds/app in every repo — org license-policy call, not a repo bug |
| `check-npm-artifacts` red (nswds-app) | committed `dist/` built before semantic-release bumped the version it inlines | `npm run build:npm` on the branch, commit dist |
| prettier --check red on synced configs (nswds-ui) | config formatting not stable across consumer prettier configs | see the ≤80-column rule under day-to-day changes |
| Push to this repo rejected mid-work | semantic-release pushed a `chore(release): x.y.z [skip ci]` commit after your last fetch | `git pull --rebase`, push again — routine |

## Consumer expectations (the social contract)

- Sync PRs are reviewed and merged by each repo's owners like any other PR;
  nothing lands unreviewed. Don't enable auto-merge on repo-sync PRs unless
  drift has been zero for a good while.
- A central change fans out as up-to-17 PRs. Batch central changes rather
  than merging five small ones in a day, or the fleet drowns in sync PRs.
- The commit vocabulary (`commit-types.mjs`) and branch vocabulary
  (`branch-name-config.sh`) are fleet-wide decisions. Changing them changes
  policy everywhere; announce before merging.

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
