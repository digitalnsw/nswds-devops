# Onboarding a repo onto the shared tooling

Adding a repo is mostly one line in `.github/sync.yml`, but the pre-flight
checks matter — every latent problem a repo has (broken lockfile, stale build
artifacts, odd branch protection) surfaces the moment the first sync PR opens
its checks. Both of those examples actually happened during the initial
rollout, so do the pre-flight properly and the onboarding is boring.

## 1. Pre-flight checks

Run these before touching sync.yml. Five minutes here saves an afternoon.

**a) The lockfile parses.** Sounds silly; isn't. nswds-public-sans sat on
`main` for three weeks with unresolved merge-conflict markers inside
`package-lock.json` (two Snyk PRs merged without regenerating it), and every
`npm ci` failed. The new commitlint check was just the first thing to notice.

```sh
node -e "JSON.parse(require('fs').readFileSync('package-lock.json','utf8')); console.log('lockfile ok')"
```

If it's corrupt: find the last commit where it parsed (`git log -- package-lock.json`,
test each), restore that version, then `npm install --package-lock-only` to
apply whatever package.json changed since. Don't just regenerate from
scratch — that resolves every transitive dep fresh and lights up Snyk.

**b) No required-status-check ruleset with old names.** Reusable workflows
report checks as `commitlint / commitlint`, not `commitlint`. A ruleset
requiring the old name blocks every PR with "Expected — waiting for status to
be reported" (this bit nswds-design). Check with:

```sh
gh api repos/digitalnsw/<repo>/rulesets --jq '.[].id' | while read id; do
  gh api repos/digitalnsw/<repo>/rulesets/$id \
    --jq '.name + ": " + ([.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context] | join(", "))'
done
```

If any required context matches a shared check's old single name, rename it
to the `job / job` form.

**c) Does it have a bespoke release pipeline?** If the repo publishes to npm
with its own verification steps, or its `release.yml` is something else
entirely (ictds-portal-flows' is a Power Platform prod deploy), it does NOT
go in group 1. Read the existing `release.yml` before deciding. When in
doubt, exclude the release file(s) first and add them in a follow-up once
you've confirmed the stock ones fit.

**d) Node version.** The reusable workflows use `.nvmrc` when present and
fall back to Node 24. If the repo needs something specific, add a `.nvmrc`.

## 2. Prepare the repo itself

Install the tooling's dependencies (skip any it already has):

```sh
npm install -D husky @commitlint/cli @commitlint/config-conventional \
  semantic-release @semantic-release/changelog @semantic-release/git \
  @semantic-release/commit-analyzer @semantic-release/github \
  @semantic-release/release-notes-generator
```

Add the script entries to `package.json`:

```json
"branch:create": "scripts/create-branch.sh",
"branch:suggest": "scripts/suggest-branch-name.sh",
"branch:suggest:create": "scripts/suggest-branch-name.sh --create",
"commit": "scripts/git-commit.sh",
"pr": "scripts/pull-request.sh"
```

Secrets: `OPENAI_API_KEY` is an org-level secret so there's normally nothing
to do. `RELEASE_DEPLOY_KEY` is only needed if the repo's `main` is
ruleset-protected — see MAINTENANCE.md for the recipe.

The sync App is installed org-wide ("All repositories"), so there's no app
step for new repos.

## 3. Add it to the sync

In this repo, add the target under the right group in
[.github/sync.yml](.github/sync.yml) (group 1 unless pre-flight said
otherwise), commit, merge to `main`. The sync fires on that push and opens
the PR in the target repo. You can also trigger it manually: Actions → "Sync
shared files to repos" → Run workflow.

Note the repo slug is the GitHub name, which isn't always the local folder
name (nswds-images is `digitalnsw/images` on GitHub).

## 4. Review and merge the first sync PR

What to check in the diff:

- Only expected paths: `scripts/` (shared files only — the sync never touches
  the repo's own scripts), the root configs, and `.github/workflows/` stubs.
- Script exec bits survived (`git ls-tree` on the branch shows `100755`).
- Nothing repo-specific was replaced.

What to expect:

- **`check-branch-name` will be red — once.** The check reads branch policy
  from the PR *base*, which doesn't have the `chore/repo-sync` exemption
  until this very PR merges it in. It's not a required check; merge past it.
  Every subsequent sync PR is green.
- The stub workflows only take effect on the *next* PR (GitHub runs
  `pull_request` workflows from the base branch's definitions), so open any
  trivial follow-up PR afterwards to watch all six stubs go green.

## 5. Post-merge cleanup

- If the repo had an older copy of the tooling, delete the superseded
  commit-types file (`commit-types.js` or `commit-types.cjs`) — the synced
  config imports `commit-types.mjs`. (Done for all 17 original repos.)
- Run `./scripts/setup-commitlint.sh` once locally to install the husky
  hooks, and sanity-check `npm run commit` works.
- If an old standalone workflow was replaced by a stub (e.g. an existing
  `semantic-release.yml`), confirm the next release run succeeds.

## Coverage

All 21 digitalnsw repos are on the sync as of 2026-07-15 (data,
nswds-community, nswds-signature and nswds-email-issues were onboarded last,
following exactly this doc — their prep PRs are worked examples: both
community and signature needed the lockfile repair from pre-flight (a),
email-issues needed its first lockfile and a real .gitignore, and community
carried the package.json name fix).

One known leftover: `nswds-images/package.json` is still named
"ictds-portal-flows" — fix it next time someone's in that repo.
