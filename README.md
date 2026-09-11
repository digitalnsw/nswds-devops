# nswds-devops

The single source of truth for the build tooling shared across the
`digitalnsw` repositories: the commit, branch and PR shell scripts, the
commitlint and semantic-release configs, the husky hook sources, the CI
workflows, the Renovate policy and the Snyk policy. These files live here once
and propagate to 28 consumer repositories automatically.

| Document | Read it when |
|---|---|
| This file | You need the mental model of how propagation works |
| [FLEET.md](FLEET.md) | You need to know which repositories exist, what each one is, and how it is configured |
| [TECH_STACK.md](TECH_STACK.md) | You need to know what the fleet is built with |
| [ONBOARDING.md](ONBOARDING.md) | You are adding a repository to the fleet |
| [MAINTENANCE.md](MAINTENANCE.md) | You are changing the shared tooling, or something is broken |
| [docs/config-single-source-of-truth.md](docs/config-single-source-of-truth.md) | You are changing a root config file (`.nvmrc`, `.npmrc`, ignore files, `.snyk`, lint and format configs) |
| [docs/best-practices/](docs/best-practices/README.md) | You want the engineering conventions the tooling enforces |

## How propagation works

There are four channels. Knowing which one applies is most of the job, and the
difference that matters most is whether a change reaches consumers on its own
or only once a pull request in each of them has merged.

**1. File-sync PRs (file contents).** Anything merged to `main` here that is
listed in [.github/sync.yml](.github/sync.yml) is pushed out by the `sync`
workflow as a `chore(ci): …` pull request in every consumer repo, with GitHub
auto-merge armed so it merges itself once that repo's required checks pass.
This covers `scripts/`, the root configs, `repo-files/` and the workflow
stubs. The sync only ever writes the exact paths listed. It never deletes
anything, so repo-specific files in the same directories are safe.

**2. Reusable workflows (CI logic).** The CI implementations live in
`.github/workflows/reusable-*.yml` here. Consumer repos hold thin stubs that
call them, pinned to the floating `v1` tag:

```yaml
jobs:
  commitlint:
    uses: digitalnsw/nswds-devops/.github/workflows/reusable-commitlint.yml@v1
```

Stubs that need a secret map it explicitly; `secrets: inherit` is never used.
Moving the `v1` tag changes CI for all 28 consumer repos at once, with no PRs.
That is why the tag is ruleset-protected and only moves through the
**Promote v1** workflow, behind a reviewer gate, after CI here is green.

**3. Read-at-runtime policy.** `default.json` is the Renovate preset every
repo's `renovate.json` extends, and Renovate resolves it from `main` here at
run time. This is the only channel where merging is the whole job: a policy
change applies fleet-wide on each repo's next Renovate run, with no sync, no
tag move and no per-repo pull request.

**4. Block sync (`.snyk`).** `snyk-policy/base.snyk` is the canonical policy
block, delivered by `snyk-policy-sync.yml` as one pull request per consumer
that rewrites the block and copies each repo's `# repo-specific` tail through
byte-for-byte. Despite living beside the Renovate preset, this behaves like
channel 1, not channel 3: **the policy is not in force in any repo until that
repo's fan-out PR merges.** It is a separate mechanism from the file sync
because `repo-file-sync-action` overwrites whole files and would delete the
repo-owned tail.

The split of file-sync plus tag was chosen over publishing an npm package: sync
PRs give every repo a reviewable diff for content changes, while the tag gives
one-step rollout and rollback for CI logic.

## Repo layout

```
├── scripts/                      # canonical shell tooling → synced to scripts/ in each repo
│   └── husky/                    # hook sources (installed into .husky/ by setup-commitlint.sh)
├── commit-types.mjs              # the list of allowed commit types → synced to repo roots
├── commitlint.config.mjs         # imports commit-types.mjs → synced
├── git-conventional-commits.yaml # kept in lockstep with commit-types.mjs, CI-enforced → synced
├── release.config.mjs            # stock semantic-release config → synced (with exclusions)
├── repo-files/                   # .nvmrc, .npmrc (+ nswds-ui variant), renovate.json → synced to roots;
│                                 # .gitignore / .prettierignore canonical bases (not yet synced)
├── workflow-stubs/               # the eight thin callers → synced to .github/workflows/ in each repo
├── default.json                  # Renovate org preset (read from main at run time)
├── snyk-policy/                  # canonical .snyk block + consumer list (own fan-out workflow)
├── tools/                        # renovate fleet dashboard generator + unit tests (npm test)
└── .github/
    ├── sync.yml                  # WHO gets WHAT (the sync groups)
    ├── confluence-sync.yml       # which markdown here mirrors to Confluence
    ├── scripts/                  # repo-local helpers: canaries, snyk-policy.mjs, test-mode.mjs
    └── workflows/
        ├── sync.yml              # the sync driver (push to main + manual dispatch)
        ├── reusable-*.yml        # the eight real CI implementations (never synced)
        ├── ci.yml                # shellcheck + actionlint + the shared gate, gates every merge here
        ├── promote-v1.yml        # the only sanctioned way to move v1 (reviewer-gated)
        ├── snyk-policy-sync.yml  # fans the Snyk policy block out when snyk-policy/ changes
        ├── *-canary.yml          # weekly probes that open a tracking issue on drift
        └── the rest              # dogfood stubs and confluence sync
```

## The sync groups

Repos are not uniform. A few have bespoke release pipelines that must never
be overwritten, and `.github/sync.yml` encodes this as groups:

| Group | Repos | What is different |
|---|---|---|
| 1 | the 20 repos not listed below | full set: scripts, all four configs, `renovate.json`, `.nvmrc`, `.npmrc`, all eight stubs |
| 2a | nswds-ui | keeps its own `release.yml` and release config (monorepo publish with verification); takes the `.npmrc-nswds-ui` variant |
| 2b | nswds-tokens | keeps its own `release.yml`, release config and `ci.yml`; the shared CI stub lands as `shared-ci.yml` |
| 2c | nswds-eslint-config, nswds-metadata, nswds-prettier-config | keep their own `release.yml` (OIDC trusted publishing), release config and `ci.yml`; shared CI stub lands as `shared-ci.yml` |
| 2d | nswds-email-design | like nswds-ui: own `release.yml` and release config, `.npmrc-nswds-ui` variant |
| 3 | nswds-app | keeps its own `release.config.mjs` (publishes `@nswds/app`); stock release stub |
| 4 | ictds-portal-flows | its `release.yml` is a Power Platform production deploy that shares the filename. The release stub maps to `semantic-release.yml` |

## The eight shared CI workflows

| Stub (in each repo) | What it does |
|---|---|
| `ci.yml` | the merge gate. Five jobs: `install` (conflict-marker scan, literal npm self-override scan, `npm clean-install`, build), `lint`, `typecheck`, `format` (`prettier --check` when a Prettier config exists) and `test` (vitest at the root, else `npm test`, else vitest in workspaces). Per-repo `CI_SKIP_*` variables opt individual jobs out. Superseded pushes cancel in-flight runs; npm tarballs are cached keyed on the lockfile |
| `commitlint.yml` | lints the PR's commits and its title against `commitlint.config.mjs` |
| `validate-branch-name.yml` | enforces branch naming from `scripts/branch-name-config.sh`, read from the PR base so a PR cannot alter its own policy |
| `commit-types-sync.yml` | fails if `commit-types.mjs` and `git-conventional-commits.yaml` disagree |
| `ai-pr-title.yml` | generates or validates Conventional Commit PR titles via the Vercel AI Gateway |
| `openai-pr-description.yml` | autofills empty PR descriptions from the redacted diff |
| `release.yml` | semantic-release on push to main: npm OIDC publish where enabled, deploy-key push to protected branches, `HUSKY=0`, failure-alert issue |
| `confluence-sync.yml` | publishes the markdown mapped in `.github/confluence-sync.yml` to Confluence on push to main; a no-op in repos without that manifest |

Check names: a reusable workflow reports as `commitlint / commitlint`
(caller job / called job), not `commitlint`. Required-check rulesets must use
the two-part names. Five contexts are required on **every** fleet repo:
`commitlint / commitlint`, `install / install`, `install / lint`,
`install / test` and `install / format`. The standard adds
`security/snyk (DigitalNSW)` and `code/snyk (DigitalNSW)`, which four repos
do not yet require, and `install / typecheck`, which five repos require.
[FLEET.md](FLEET.md) lists the per-repo deltas and records the missing Snyk
gates as open issues — do not assume a given repo has them.

## Developer usage (in any consumer repo)

```
npm run branch:create           # interactive branch creation
npm run branch:suggest          # AI-suggested branch name from your diff
npm run branch:suggest:create   # suggest + create in one step
npm run commit                  # AI-assisted Conventional Commit (with secret redaction)
npm run pr                      # AI-assisted PR creation
```

Rule number one for consumers: **never edit the synced files in a consumer
repo.** The next sync PR overwrites the change without comment. Edit here,
merge, and let the sync deliver it everywhere.

### Break-glass: pushing to a protected branch

`scripts/push-to-protected-branch.sh` has no npm alias because it is not part
of the everyday loop. It covers the rare case where the default branch must
take a push while CI is broken: it disables that repo's branch rulesets,
pushes, then restores every ruleset from an `EXIT` trap, so protection is off
only for the duration of the push and comes back even on error or `Ctrl-C`.

```
./scripts/push-to-protected-branch.sh                   # prompts, prefilled from the current clone
./scripts/push-to-protected-branch.sh digitalnsw/agile  # or name the target repo
```

It lists the rulesets that apply and waits for confirmation before changing
anything; answering `n` touches nothing. Run from inside the target clone it
pushes for you; run from anywhere else it drops protection and waits while
you push by hand, auto-restoring after five minutes. Organisation-level
rulesets are reported and skipped, since they cannot be changed from repo
scope.

Read the ruleset bypass policy in [MAINTENANCE.md](MAINTENANCE.md) before
reaching for it. Adding yourself as a ruleset bypass actor is not the
sanctioned alternative; this two-step is, because it is temporary and shows
up in the audit log at both ends.

## Versioning of this repo

semantic-release runs on every push to `main` and cuts a version from the
commit types (`fix:` → patch, `feat:` → minor). That is automatic and mostly
gives us a changelog. The `v1` tag that consumers pin to is separate and
manual; see [MAINTENANCE.md](MAINTENANCE.md).

## Testing this repo

```sh
npm test    # unit tests for tools/, release.config.mjs, .github/scripts/snyk-policy.mjs and test-mode.mjs
```

That suite includes `tools/fleet-docs.test.mjs`, which holds the fleet counts
in this documentation to `.github/sync.yml` and `snyk-policy/repos.json`.
Adding a repo to the sync without updating FLEET.md and the stated counts
fails it. It guards size and membership only — no test can tell you whether
what FLEET.md says *about* a repo is still true.

CI additionally runs shellcheck over every shared script and actionlint over
the workflows and the stubs (stubs are copied into a scratch tree so
actionlint scans them). All three are required checks on `main` here.
