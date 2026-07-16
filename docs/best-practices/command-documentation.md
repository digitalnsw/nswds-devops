# Command Documentation

How commands (shell scripts and npm scripts) are named, documented, and
discovered across the repos.

## Required tools

The shared scripts assume these are installed:

| Tool | Used for | Install (macOS) |
| --- | --- | --- |
| GitHub CLI (`gh`) | `pull-request.sh` creates PRs; authenticate once with `gh auth login` | `brew install gh` |
| `jq` | JSON handling for OpenAI API requests/responses | `brew install jq` |
| `curl` | HTTP requests to the OpenAI API | pre-installed |

The AI-assisted scripts also need `OPENAI_API_KEY` in the environment. The
default model is set once in `scripts/openai-config.sh` (override per-run
with `OPENAI_MODEL=…`).

## The shared script suite

Synced into every repo's `scripts/` from this repo. The user-facing ones:

| Command | What it does |
| --- | --- |
| `./scripts/create-branch.sh {type}/[issue\|ticket/{id}/]{slug}` | Creates (and pushes) a branch, validating the name against the shared policy first — e.g. `./scripts/create-branch.sh feat/ticket/ABC-456/add-login-button`. Run with no argument to be prompted. Rejections explain the allowed formats. |
| `./scripts/suggest-branch-name.sh` | Proposes a compliant branch name for your change. |
| `./scripts/git-commit.sh` | AI-generated Conventional Commit message from your staged diff (commits via `git commit -F -`, so the commit-msg hook still lints it). |
| `./scripts/pull-request.sh` | Generates a Conventional-Commits PR title from your branch's commits, asks for confirmation, then opens the PR with `gh pr create`. |
| `./scripts/setup-commitlint.sh` | Installs and wires commitlint + the husky `commit-msg` hook in the current repo. Idempotent. |

Supporting pieces you rarely invoke directly: `branch-name-config.sh`
(policy source of truth), `conventional-commit-config.sh` +
`check-commit-types-sync.sh` (commit-type plumbing), `openai-config.sh` /
`openai-request.sh` (shared OpenAI defaults + request helper),
`secret-redaction.sh` (detects and redacts secret-looking content **before
any diff leaves the machine** for the OpenAI API), `wrap-commit-body.sh`
(reflows AI prose to pass commitlint's line-length rule), and the husky
`commit-msg` / `prepare-commit-msg` hooks that tie it together. OpenCommit
(`oco`) also works locally if you prefer it — the hooks reflow and lint
whatever tool wrote the message.

## npm scripts are the public interface

Every routine task in a repo should be reachable as an npm script with a
predictable name, so contributors never need tribal knowledge:

| Script | Purpose |
| --- | --- |
| `build` | Produce the build output (CI runs it via `npm run build --if-present`) |
| `test` | Run the test suite |
| `lint` | Run the linters |
| `check:*` | Verification commands that fail loudly (e.g. `check:dist`, `check:version-sync` in nswds-tokens) |
| `release` | semantic-release entry point (invoked by CI, not by hand) |

Prefer adding a `check:<thing>` script over documenting a one-off command in
a README — a script is discoverable via `npm run` and usable in CI.

## Shell scripts live in `scripts/`

The shared scripts are synced from this repo's `scripts/` directory into
every consumer. Conventions they follow (and new scripts should too):

- A header comment stating purpose and how the script is invoked.
- Usage text on bad arguments (see `scripts/create-branch.sh`).
- Config separated from behaviour: policy values live in sourceable files
  (`branch-name-config.sh`) so CI and local tooling share one definition.
- Shellcheck-clean — CI shellchecks every shared script; deliberate
  exceptions carry an inline `# shellcheck disable=` with a reason.

## Documenting a new command

1. Header comment in the script (what/why/usage).
2. If contributors run it directly, add one line to the repo README.
3. If it's a gate, wire it into CI and name it `check:*` — the CI log then
   documents when and why it runs.
