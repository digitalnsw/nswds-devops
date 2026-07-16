# Dependency Management Strategy

Three layers, each with one job: **Renovate** proposes routine updates,
**Snyk** watches security, and the **`install / install` merge gate**
guarantees nothing corrupt lands regardless of who proposed it.

## Renovate (routine updates)

- Org policy lives in this repo's [`default.json`](../../default.json)
  preset; every repo's synced `renovate.json` just extends it. Change
  policy **here** — it applies fleet-wide on Renovate's next run.
- Cadence: grouped non-major PR weekly (Monday before 7am Sydney); majors
  arrive as individual PRs; monthly lock-file maintenance regenerates
  lockfiles with real npm.
- Commits as `chore(deps):` — merging an update doesn't force a release;
  cut one deliberately when it matters (`fix(deps):` retitle if the bump
  itself is the fix consumers need).
- The Dependency Dashboard issue in each repo is the control panel — tick a
  checkbox to force a PR outside the schedule.

## Snyk (security)

- PR checks (`code/security/license`) run on every PR.
- Automatic fix PRs are scoped to Critical/High severity; automatic
  **dependency upgrade PRs are disabled org-wide** — routine upgrades are
  Renovate's job, and Snyk's lockfile splicing is what once corrupted a
  lockfile on `main`.

## Lockfile rules (the hard ones)

- `package-lock.json` is generated output: **only npm writes it**, on the
  Node/npm version pinned by `.nvmrc`.
- **Never resolve lockfile merge conflicts in the web editor.** Regenerate
  locally or let the bot recreate its PR ([Pull Requests](pull-requests.md)).
- The merge gate (`npm clean-install` on the PR's test merge) is the
  backstop — it has already caught live conflict-marker corruption; treat a
  red `install / install` on a bot PR as "close and regenerate", not
  "resolve and force".

## Adding dependencies

- Justify new runtime deps in the PR — every one is an attack surface Snyk
  and Renovate then babysit forever; prefer the platform or stdlib.
- Pin GitHub Actions per [GitHub Actions](github-actions.md); npm deps use
  caret ranges with the lockfile as the true pin.
