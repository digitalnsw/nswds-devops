# shared-build-scripts

Single source of truth for the digitalnsw shared build tooling. Everything that used to be copy-pasted between repos lives here once:

| What | Where | How it reaches consumer repos |
|---|---|---|
| Commit / branch / PR shell tooling | `scripts/` | File-sync PRs → `scripts/` in each repo |
| Husky hook sources | `scripts/husky/` | File-sync PRs (installed into `.husky/` by `scripts/setup-commitlint.sh`) |
| Commit-type source of truth | `commit-types.mjs` | File-sync PRs → repo root |
| Commitlint config | `commitlint.config.mjs` | File-sync PRs → repo root |
| git-conventional-commits config | `git-conventional-commits.yaml` | File-sync PRs → repo root |
| semantic-release config | `release.config.mjs` | File-sync PRs → repo root (repos with bespoke release configs are excluded — see `.github/sync.yml`) |
| CI workflow logic | `.github/workflows/reusable-*.yml` | Not synced — repos call them via `workflow_call` |
| CI workflow stubs | `workflow-stubs/` | File-sync PRs → `.github/workflows/` in each repo |

## How updates propagate

1. Change a file here and merge to `main`.
2. The `sync` workflow ([.github/workflows/sync.yml](.github/workflows/sync.yml)) opens a `chore(ci): sync shared build tooling` PR in every repo listed in [.github/sync.yml](.github/sync.yml).
3. Each repo reviews and merges its PR. Repo-specific files are never touched (the sync only writes the exact paths listed; `deleteOrphaned` is off).

Reusable workflow changes propagate instantly to every repo once the `v1` tag is moved — no sync PR needed. Stubs reference `digitalnsw/shared-build-scripts/.github/workflows/reusable-*.yml@v1`.

## Rules

- **Never edit these files in a consumer repo.** The next sync PR will overwrite the change. Edit here instead.
- `commit-types.mjs` is the single source of truth for allowed commit types; `git-conventional-commits.yaml` must be kept in lockstep (CI enforces this via `scripts/check-commit-types-sync.sh`).
- Scripts must pass shellcheck (CI runs it on every PR).
- Moving the `v1` tag changes CI for every consumer repo at once — only move it after central CI is green.

## Consumer repo usage

The synced scripts are wired through each repo's `package.json`:

```
npm run branch:create           # scripts/create-branch.sh
npm run branch:suggest          # scripts/suggest-branch-name.sh
npm run branch:suggest:create   # scripts/suggest-branch-name.sh --create
npm run commit                  # scripts/git-commit.sh
npm run pr                      # scripts/pull-request.sh
```

## Onboarding a new repo

1. `npm install -D husky @commitlint/cli @commitlint/config-conventional semantic-release @semantic-release/git @semantic-release/changelog`
2. Add the repo to the appropriate group in [.github/sync.yml](.github/sync.yml) (group 1 = full set; group 2 = repos with a bespoke `release.config`).
3. Merge the first sync PR, then run `./scripts/setup-commitlint.sh` to install the husky hooks.
4. Add the `package.json` script entries shown above, plus `OPENAI_API_KEY` (repo or org secret) for the AI-assisted workflows.

## Auth for the sync workflow

The sync runs with a GitHub App token (`SYNC_APP_ID` variable + `SYNC_APP_PRIVATE_KEY` secret on this repo). The App needs **Contents: read/write, Pull requests: read/write, Workflows: read/write** on every target repo. See [SETUP.md](SETUP.md).
