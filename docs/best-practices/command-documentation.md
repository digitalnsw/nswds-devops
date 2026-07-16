# Command Documentation

How commands (shell scripts and npm scripts) are named, documented, and
discovered across the repos.

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
