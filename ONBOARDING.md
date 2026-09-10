# Onboarding a repo onto the shared tooling

This is the complete path from a repo that does not exist yet (or exists
outside the fleet) to a fully configured fleet member. A fleet member has:
the synced tooling files, the eight shared CI workflows, a protected `main`
with required checks, Renovate and Snyk coverage, the canonical Snyk policy
block, the shared ESLint and Prettier configs, and the release pipeline.

Start at **Path A** for a brand-new repo. For an existing repo, run the
**Path B pre-flight** first, then continue from Path A step 2. When the repo
is done, add it to [FLEET.md](FLEET.md).

## What a fleet repo ends up with

| Layer | Contents | Delivered by |
|---|---|---|
| Synced files | `scripts/` (shared shell tooling), `commit-types.mjs`, `commitlint.config.mjs`, `git-conventional-commits.yaml`, `release.config.mjs` (groups 1 and 4 only), `renovate.json`, `.nvmrc`, `.npmrc` | File sync (step 5) |
| Workflow stubs | `ci.yml`, `commitlint.yml`, `validate-branch-name.yml`, `commit-types-sync.yml`, `ai-pr-title.yml`, `openai-pr-description.yml`, `release.yml`, `confluence-sync.yml`: thin callers pinned to `@v1` | File sync (step 5) |
| Snyk policy | `.snyk` with the canonical block above a `# repo-specific` marker | Snyk policy fan-out (step 8) |
| Lint/format config | `@nswds/eslint-config` (npm) + `eslint.config.mjs`; `@nswds/prettier-config` (npm) + `.prettierrc.mjs` or `package.json` key | Manual (steps 2 and 3) |
| Branch governance | "Protect main" ruleset (7 required checks, `DeployKey` bypass only), squash-only merges, branch auto-delete, auto-merge allowed | Manual (steps 1 and 7) |
| Release | semantic-release via the synced stub, pushing over `RELEASE_DEPLOY_KEY` | Manual key setup (step 6) |
| Dependency management | Renovate (Mend app, org preset) and Snyk PR scanning | Console (steps 8 and 9) |

## Path A: brand-new repo

### 1. Create the repo

```sh
gh repo create digitalnsw/<repo> --private --clone
```

Set the fleet-standard repo flags immediately: squash is the only merge
method (every PR becomes exactly one conventional commit), merged branches
are deleted, and auto-merge is allowed (Renovate's automerged categories and
the sync fan-out rely on it):

```sh
gh api -X PATCH repos/digitalnsw/<repo> \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true
```

The GitHub slug is what goes in `sync.yml` and `snyk-policy/repos.json`, and
it is not always the local folder name (local `nswds-images` is
`digitalnsw/images`; local `nswds-data` is `digitalnsw/data`).

### 2. Baseline `package.json`

Create `package.json` with, at minimum:

- `"name"` matching the repo slug.
- The fleet engines range. `engines` is not a synced file, and the synced
  `.npmrc` sets `engine-strict=true`, so without this block the Node-floor
  control is inert:

```json
"engines": {
  "node": "^22.22.2 || >=24.15.0"
}
```

- The helper script entries (the scripts themselves arrive via sync):

```json
"branch:create": "scripts/create-branch.sh",
"branch:suggest": "scripts/suggest-branch-name.sh",
"branch:suggest:create": "scripts/suggest-branch-name.sh --create",
"commit": "scripts/git-commit.sh",
"pr": "scripts/pull-request.sh"
```

- Gate scripts as applicable: `"lint": "eslint ."`,
  `"type-check": "tsc --noEmit"` (or `typecheck`; both spellings are
  detected), `"format": "prettier --write ."`,
  `"format:check": "prettier --check ."`, and a real `"test"` script if the
  repo has a suite. The shared CI jobs run `lint` and `test` with
  `--if-present`, the typecheck job runs only when a script exists, and the
  format job runs only when a Prettier config exists. A missing script means
  a silently green gate, so wire up every one the repo can honestly run.

Before installing anything, make sure `.gitignore` covers at least
`node_modules/` and `.DS_Store`. A bare repo has no ignore file and the first
`npm install` otherwise stages the entire dependency tree. The canonical base
is [repo-files/.gitignore](repo-files/.gitignore).

### 3. Install the toolchain

Commit and release stack (every repo):

```sh
npm install -D husky @commitlint/cli @commitlint/config-conventional \
  semantic-release @semantic-release/changelog @semantic-release/git \
  @semantic-release/commit-analyzer @semantic-release/github \
  @semantic-release/release-notes-generator \
  conventional-changelog-conventionalcommits@^9
```

The explicit `conventional-changelog-conventionalcommits@^9` pin at the repo
root is required: v10 silently produces empty changelogs under the shared
release config, and the weekly `ccc pin drift canary` opens an issue for any
semantic-release repo missing the pin.

Prettier (every repo that has formattable source):

```sh
npm install -D prettier @nswds/prettier-config
```

Then either the `package.json` key (base config only, no local additions):

```json
"prettier": "@nswds/prettier-config"
```

or, for repos that layer plugins (any Tailwind repo), a `.prettierrc.mjs`:

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

Add a `.prettierignore` that excludes `CHANGELOG.md` (semantic-release
rewrites it unformatted on every release; leaving it checked re-reds the
format gate at the next release) plus any generated or machine-written output
(build artefacts, ORM meta snapshots, generated modules, email template
HTML). The canonical base is [repo-files/.prettierignore](repo-files/.prettierignore).

ESLint: pick the entry point that matches the repo.

- **Next.js app**: `@nswds/eslint-config` (the `.` entry point):

  ```sh
  npm install -D @nswds/eslint-config eslint eslint-config-next \
    eslint-config-prettier eslint-plugin-prettier @eslint/compat
  ```

  ```js
  // eslint.config.mjs
  import { defineConfig, globalIgnores } from 'eslint/config'
  import nswds from '@nswds/eslint-config'

  export default defineConfig([
    ...nswds,
    // repo-specific ignores go here
  ])
  ```

- **Everything else** (IaC, pipelines, node scripts, plain sites):
  `@nswds/eslint-config/base`:

  ```sh
  npm install -D @nswds/eslint-config eslint @eslint/js typescript-eslint \
    eslint-config-prettier eslint-plugin-prettier @eslint/compat prettier
  ```

  ```js
  // eslint.config.mjs
  import nswds from '@nswds/eslint-config/base'

  export default nswds
  ```

Run `npm run lint`, `npx prettier --write .` and commit the results. The repo
must be gate-clean before the gates become required.

### 4. First push

Push `main` with the baseline in place **before** adding branch protection,
or the first push itself is blocked.

### 5. Add the repo to the sync

In this repo, add the slug under the right group in
[.github/sync.yml](.github/sync.yml):

- **Group 1**, the default: full file set including the stock release stub
  and `release.config.mjs`.
- **Group 2**: repos with a bespoke `release.yml` and release config (npm
  publishers with their own verification). 2a nswds-ui and 2d
  nswds-email-design also take the `.npmrc-nswds-ui` variant; 2b nswds-tokens
  and 2c (the three small `@nswds` config packages) keep their own `ci.yml`,
  so the shared CI stub lands as `shared-ci.yml`.
- **Group 3**: own `release.config.mjs`, stock release stub (nswds-app).
- **Group 4**: `release.yml` is a different pipeline entirely
  (ictds-portal-flows, a Power Platform deploy); the release stub maps to
  `semantic-release.yml`.

When in doubt, exclude the release files first and add them once the stock
ones are confirmed to fit. Before syncing any workflow stub, check which
files the repo already has by that name; filename collisions are the
recurring trap of this system.

Merge to `main`; the sync opens a `chore(ci): …` PR in the target repo
(manual trigger: Actions → "Sync shared files to repos" → Run workflow).

Reviewing that first sync PR:

- Only expected paths: `scripts/` shared files, the root configs, and
  `.github/workflows/` stubs. Nothing repo-specific replaced.
- Script file modes match central: everything under `scripts/` is `100755`
  except `scripts/husky/pre-commit`, which is `100644` by design
  (`git ls-tree -r` on the branch).
- `check-branch-name` reports red on this one PR only. The check reads
  branch policy from the PR base, which gains the `chore/repo-sync`
  exemption when this PR merges. It is not a required check; merge past it.
- The stub workflows take effect on the next PR (GitHub runs `pull_request`
  workflows from the base branch), so the full check set first appears on
  the verification PR in step 10.

### 6. Release deploy key

`RELEASE_DEPLOY_KEY` lets semantic-release push release commits to the
protected `main` (the key is the ruleset's bypass actor; the default
`GITHUB_TOKEN` cannot push once required checks are enforced). Follow the
deploy-key recipe in [MAINTENANCE.md](MAINTENANCE.md): generate a keypair,
add the public half as a **write** deploy key named `release-bot`, store the
private half as the `RELEASE_DEPLOY_KEY` repo secret, delete both local key
files.

`AI_GATEWAY_API_KEY` (AI PR title and description workflows; Vercel AI
Gateway) and the Azure OpenAI fallback (`AZURE_OPENAI_API_KEY` secret plus
the `AZURE_OPENAI_ENDPOINT` variable) are org-level; nothing to do per repo.
The sync App is installed org-wide; nothing to do per repo.

### 7. Branch protection

Create the "Protect main" ruleset. Two rules apply to the required-check
list:

- Contexts from reusable workflows use the two-part `caller job / called
  job` form (`install / install`, not `install`).
- Require only contexts the repo **demonstrably receives**. That is why the
  recipe below deliberately omits the two Snyk contexts: they come from the
  Snyk console integration (step 8), and requiring them before a PR has
  shown all three `…/snyk (DigitalNSW)` statuses posting blocks every merge
  on "Expected — waiting for status". They are added in step 10.

```sh
gh api -X POST repos/digitalnsw/<repo>/rulesets --input - <<'EOF'
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "bypass_actors": [{"actor_type": "DeployKey", "bypass_mode": "always"}],
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": true,
      "required_status_checks": [
        {"context": "commitlint / commitlint"},
        {"context": "install / install"},
        {"context": "install / lint"},
        {"context": "install / test"},
        {"context": "install / format"}
      ]
    }}
  ]
}
EOF
```

Add `{"context": "install / typecheck"}` when the repo has a `type-check` or
`typecheck` script; the job self-skips otherwise and a skipped required check
would never report.

Bypass policy: **DeployKey only**. No admin or role bypass actors (the
rationale is in the ruleset bypass policy section of MAINTENANCE.md).

### 8. Snyk

Two parts: the console integration and the canonical policy block.

**Console.** Import the repo into the `digitalnsw` Snyk organisation (Snyk
console → Add project → GitHub). Snyk then posts three commit statuses on
every PR head, `code/snyk`, `security/snyk` and `license/snyk (DigitalNSW)`,
and retests `main` against new advisories between PRs. The fleet requires
`security` and `code` as merge gates; `license` stays advisory.

Snyk posts statuses on PR heads only, never on `main` merge commits, so
absence on `main` is normal. If a PR head never receives the statuses (Snyk
sometimes skips force-updated, reopened App-authored branches), the required
contexts block that PR; the unblock is removing the two contexts from the
ruleset for the single merge and restoring them immediately after.

**Policy block.** Add the slug as a plain key in
[snyk-policy/repos.json](snyk-policy/repos.json) and merge. The Snyk policy
sync opens a PR that creates `.snyk` with the canonical block and an empty
`# repo-specific` tail. A repo that already has a `.snyk` written before the
convention needs a one-time `migrate` directive instead; see
[snyk-policy/README.md](snyk-policy/README.md).

### 9. Renovate

The Mend Renovate GitHub App is installed on **selected repositories**, so
select the new repo in the installation
(https://developer.mend.io/github/digitalnsw, or org Settings → GitHub Apps
→ Renovate → Configure). The synced `renovate.json` extends the org preset
(`default.json` in this repo); policy changes apply on Renovate's next run
with no per-repo work.

### 10. Verify, then tighten

Open a trivial PR (a README line). Expected checks: the `install / *` jobs
(`install`, `lint`, `typecheck`, `format`, `test`), `commitlint / commitlint`,
`check-branch-name / check-branch-name`, `generate-title / generate-title`,
`openai-pr-description / openai-pr-description`, and the three Snyk
statuses. Superseding a push mid-run cancels the in-flight CI run.

Once all three Snyk statuses have posted green, tighten the ruleset by
adding the two Snyk merge gates: fetch the ruleset id from
`gh api repos/digitalnsw/<repo>/rulesets`, append
`{"context": "security/snyk (DigitalNSW)"}` and
`{"context": "code/snyk (DigitalNSW)"}` to `required_status_checks`, and
PUT it back. After the merge, confirm the PR branch auto-deleted (step 1)
and the "Confluence docs sync" run on `main` is a fast green no-op.

Repo Actions **variables** (not secrets) tune the shared CI where needed:

| Variable | Effect | Use when |
|---|---|---|
| `CI_SKIP_BUILD=true` | skips the build step in `install / install` | build needs deploy-time env, or is too slow for the 15-minute job timeout |
| `CI_SKIP_LINT=true`, `CI_SKIP_TYPECHECK=true`, `CI_SKIP_TESTS=true`, `CI_SKIP_FORMAT=true` | skips that job (still satisfies the required check) | temporary red-gate escape hatch while a repo converges |

### 11. Local developer setup

Each developer clones and runs:

```sh
npm install
./scripts/setup-commitlint.sh   # installs the husky hooks
npm run commit                  # sanity check the AI-assisted commit flow
```

Branch names must match the enforced types
(`feat|fix|hotfix|release|docs|build|test|refactor|style|chore|export|ai|copilot|cursor|claude|codex`);
`npm run branch:create` builds a compliant name interactively.

### 12. npm publishers only

A repo that publishes a package does not belong in group 1; decide its
group in step 5 (own release verification → group 2; own release config
only → group 3). Publishing uses **OIDC trusted publishing**: configure the
trusted publisher on npmjs.com (package → Settings → Trusted Publisher →
GitHub Actions, workflow `release.yml`) so releases carry provenance with
no `NPM_TOKEN` secret. The web UI's stricter publishing-access option can
silently fail to save; `npm access set mfa=publish <package>` from a
logged-in CLI is the reliable path. Provenance requires a **public** source
repo; a private publisher needs `provenance=false` in `.npmrc`
(the `repo-files/.npmrc-nswds-ui` variant).

### 13. Confluence docs sync (optional)

Every repo gets the `confluence-sync.yml` stub from the sync, but it
publishes nothing until the repo opts in. To mirror markdown to Confluence
(pages are read-only mirrors with a "synced from GitHub" banner; the repo
stays the source of truth):

1. Grant the repo the org-level `CONFLUENCE_USER` and `CONFLUENCE_TOKEN`
   secrets (org admin; both secrets use a selected-repositories list):

   ```sh
   repo_id=$(gh api repos/digitalnsw/<repo> -q .id)
   gh api -X PUT orgs/digitalnsw/actions/secrets/CONFLUENCE_USER/repositories/$repo_id
   gh api -X PUT orgs/digitalnsw/actions/secrets/CONFLUENCE_TOKEN/repositories/$repo_id
   ```

2. Work out the destination folder chain: the exact folder **titles**,
   top-down, beneath the GDS space home page. mark matches titles exactly,
   case included. For an existing folder, take the id from its URL, open
   `https://dsia.atlassian.net/wiki/api/v2/folders/<id>` while signed in,
   and follow `parentId` upward until `parentType` is `page`; the titles
   you passed, reversed, are the chain. Folders that do not exist yet are
   created on first publish.

3. Pre-flight the files: every synced file needs an H1 (it becomes the page
   title), no two synced files anywhere in the fleet may share one, and a
   directory source publishes only the `*.md` directly inside it
   (subdirectories need their own entries).

4. Add a `.github/confluence-sync.yml` manifest, file or directory sources
   mapped to folder chains (full schema and caveats:
   [MAINTENANCE.md](MAINTENANCE.md), Confluence docs sync):

   ```yaml
   pages:
     - source: docs/                   # every *.md directly in the dir
       folders: [Application Support, Applications, ICT DS, portal]
     - source: README.md               # a single file
       folders: [Application Support, Applications, ICT DS, portal]
   ```

5. Merge to `main` and confirm the "Confluence docs sync" run lists every
   expected page. A retitled or deleted file orphans its old page (delete it
   in Confluence by hand), and in a **private** repo the rewritten links to
   non-synced files point at github.com, so Confluence readers without repo
   access hit a login wall on those links.

Existing manifests to copy from: this repo, `ictds-portal-flows` and `share`.

### 14. Register it

Add a row to [FLEET.md](FLEET.md) with the repo's purpose, deploy target,
sync group and any required-check delta.

## Path B: existing repo pre-flight

Run these before touching `sync.yml`; every latent problem surfaces the
moment the first sync PR opens its checks.

**a) The lockfile parses and installs.**

```sh
node -e "JSON.parse(require('fs').readFileSync('package-lock.json','utf8')); console.log('lockfile ok')"
npm clean-install
```

If it is corrupt: find the last commit where it parsed
(`git log -- package-lock.json`, test each), restore that version, then
`npm install --package-lock-only` to apply whatever `package.json` changed
since. Do not regenerate from scratch; that resolves every transitive
dependency fresh and floods the security scanner with new findings.

**b) No required-status-check ruleset using old single-part names.**
Reusable workflows report `commitlint / commitlint`, not `commitlint`; a
ruleset requiring the old name blocks every PR with "Expected — waiting for
status to be reported".

```sh
gh api repos/digitalnsw/<repo>/rulesets --jq '.[].id' | while read id; do
  gh api repos/digitalnsw/<repo>/rulesets/$id \
    --jq '.name + ": " + ([.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context] | join(", "))'
done
```

**c) Bespoke release pipeline?** If `release.yml` publishes to npm with its
own verification, or is a different pipeline that shares the filename, the
repo is not group 1; see the group table in step 5.

**d) Node version.** The reusable workflows use `.nvmrc` when present
(synced canonical: `24.16.0`) and fall back to Node 24.

**e) Superseded tooling copies.** Delete any older `commit-types.js` or
`commit-types.cjs` (the synced config imports `commit-types.mjs`), and any
standalone workflow a stub will replace. Confirm the next release run
succeeds after the first sync merge.

**f) Existing `.snyk`.** If the repo already carries one, it needs a
`migrate` directive in `snyk-policy/repos.json` for its first fan-out
([snyk-policy/README.md](snyk-policy/README.md)).

**g) Literal npm self-overrides.** A package declared both as a direct
dependency and as a literal-pinned `overrides` entry fails the
`install / install` gate. Convert to the `$`-reference form
(`"postcss": "$postcss"`).

Then continue from Path A step 2, skipping anything the repo already has.

## Coverage

All 28 consumer repos are on the sync. The fleet-wide expectations this doc
targets (ruleset contexts, Snyk gating, format gate, engines range, Snyk
policy block) are live on every member except the drift recorded under
[FLEET.md open issues](FLEET.md#open-issues); a new repo should arrive at the
same end state.
