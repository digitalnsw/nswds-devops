# nswds-devops

This repo is the single source of truth for the build tooling shared across
all digitalnsw repos: the commit/branch/PR shell scripts, commitlint and
semantic-release configs, husky hook sources, and the CI workflows. Before
July 2026 these files were copy-pasted into every repo and had drifted into
three or four variants; now they live here once and propagate automatically.

If you're picking this up from me: read this file for the mental model, then
[ONBOARDING.md](ONBOARDING.md) when you need to add a repo, and
[MAINTENANCE.md](MAINTENANCE.md) for day-to-day operation and the
troubleshooting notes. The troubleshooting section is written from real
incidents, not hypotheticals — trust it.

## How propagation works

There are two channels, and knowing which one applies is most of the job:

**1. File-sync PRs (file contents).** Anything merged to `main` here that's
listed in [.github/sync.yml](.github/sync.yml) gets pushed out by the `sync`
workflow as a `chore(ci): …` pull request in every consumer repo. Each repo
reviews and merges its own PR. This covers `scripts/`, the root configs, and
the workflow *stubs*. The sync only ever writes the exact paths listed — it
never deletes anything, so repo-specific files sitting in the same
directories are safe.

**2. Reusable workflows (CI logic).** The actual CI implementations live in
`.github/workflows/reusable-*.yml` here. Consumer repos only hold thin stubs
that call them, pinned to the floating `v1` tag:

```yaml
jobs:
  commitlint:
    uses: digitalnsw/nswds-devops/.github/workflows/reusable-commitlint.yml@v1
    secrets: inherit
```

Moving the `v1` tag changes CI for all 17 repos at once, instantly, with no
PRs. That's the point — and also why the tag only moves deliberately, after
CI here is green. See MAINTENANCE.md for the exact motion.

I deliberately chose this split over publishing an npm package: the sync PRs
give every repo a reviewable diff for content changes, while the tag gives
one-step rollout (and one-step rollback) for CI logic.

## Repo layout

```
├── scripts/                      # canonical shell tooling → synced to scripts/ in each repo
│   └── husky/                    # hook sources (installed into .husky/ by setup-commitlint.sh)
├── commit-types.mjs              # THE list of allowed commit types → synced to repo roots
├── commitlint.config.mjs         # imports commit-types.mjs → synced
├── git-conventional-commits.yaml # kept in lockstep with commit-types.mjs, CI-enforced → synced
├── release.config.mjs            # stock semantic-release config → synced (with exclusions)
├── workflow-stubs/               # the thin callers → synced to .github/workflows/ in each repo
└── .github/
    ├── sync.yml                  # WHO gets WHAT (the four groups — see below)
    └── workflows/
        ├── sync.yml              # the sync driver (push to main + manual dispatch)
        ├── reusable-*.yml        # the six real CI implementations (never synced)
        ├── ci.yml                # shellcheck + actionlint, gates every merge here
        └── the rest              # this repo dogfooding its own stubs via local references
```

## The four sync groups

Repos aren't uniform — a few have bespoke release pipelines that must never
be overwritten. `.github/sync.yml` encodes this as four groups:

| Group | Repos | What's different |
|---|---|---|
| 1 | everything not listed below | full set: scripts, all four configs, all six stubs |
| 2 | nswds-ui, nswds-tokens | keep their own `release.yml` AND release config (both publish to npm with bespoke verification) |
| 3 | nswds-app | keeps its own `release.config.mjs` (publishes `@nswds/app`); stock release stub is fine |
| 4 | ictds-portal-flows | ⚠️ its `release.yml` is a **Power Platform production deploy** that happens to share the filename — never overwrite it. The release stub maps to `semantic-release.yml` instead |

## The six shared CI checks

| Stub (in each repo) | What it does |
|---|---|
| `commitlint.yml` | lints PR commit messages against `commitlint.config.mjs` |
| `validate-branch-name.yml` | enforces branch naming from `scripts/branch-name-config.sh` (read from the PR *base* so PRs can't alter their own policy) |
| `commit-types-sync.yml` | fails if `commit-types.mjs` and `git-conventional-commits.yaml` disagree |
| `ai-pr-title.yml` | generates/validates Conventional Commit PR titles via OpenAI |
| `openai-pr-description.yml` | autofills empty PR descriptions |
| `release.yml` | semantic-release on push to main (handles npm OIDC publish, deploy-key push to protected branches, HUSKY=0) |

Note the check names: a reusable workflow reports as `commitlint / commitlint`
(caller job / called job), not `commitlint`. Required-check rulesets must use
the two-part names.

## Developer usage (in any consumer repo)

```
npm run branch:create           # interactive branch creation
npm run branch:suggest          # AI-suggested branch name from your diff
npm run branch:suggest:create   # suggest + create in one step
npm run commit                  # AI-assisted Conventional Commit (with secret redaction)
npm run pr                      # AI-assisted PR creation
```

Rule number one for consumers: **never edit the synced files in a consumer
repo.** The next sync PR will overwrite the change without comment. Edit
here, merge, and let the sync deliver it everywhere.

## Versioning of this repo

semantic-release runs on every push to `main` and cuts a version from the
commit types (`fix:` → patch, `feat:` → minor). That's automatic and mostly
just gives us a changelog. The `v1` tag that consumers pin to is separate and
manual — see MAINTENANCE.md.
