# GitHub Actions Documentation

Architecture and rules for CI/CD workflows across the fleet. The full
operating manual is [MAINTENANCE.md](../../MAINTENANCE.md); this is the
practice summary.

## Architecture: stubs call reusables

- **Consumer repos hold synced stubs** (`.github/workflows/*.yml`, marked
  DO NOT EDIT) that do three things only: declare triggers, grant
  permissions, and call a reusable workflow here with `secrets: inherit`.
- **Logic lives in this repo's `reusable-*.yml`**, called at the floating
  **`@v1` tag**. Merging a reusable change here does nothing until `v1` is
  moved (`git tag -f v1 <commit> && git push -f origin v1`) — treat the move
  as a deploy; central CI must be green first. Breaking changes ship as a
  new `@v2` tag plus a stub update, delivered as reviewable sync PRs.
- **Status-check contexts are `caller-job / called-job`** (e.g.
  `install / install`). Branch rulesets reference these names — renaming a
  job in a stub or reusable orphans every ruleset that requires it.

## Rules

- Permissions are declared in the stub, least-privilege, per workflow — a
  reusable can never exceed what the caller grants.
- **Pin third-party actions to a commit SHA** when they hold write access or
  secrets (`repo-file-sync-action`, `openai-pr-description` are pinned for
  exactly this reason). First-party `actions/*` may float on major tags.
- Workflows that push to a protected `main` authenticate with the repo's
  `RELEASE_DEPLOY_KEY` (a deploy key that is a ruleset bypass actor), never
  a PAT. The reusable release workflow auto-detects the secret.
- Env-dependent app builds opt out of the CI build step with the
  `CI_SKIP_BUILD=true` repo variable — the lockfile and conflict-marker
  gates still run.
- Everything is linted: actionlint covers workflows **and** stubs (they're
  copied into a scratch tree), shellcheck covers embedded scripts.
- Reruns pin reusable refs to the SHA resolved at the original run. After
  moving `@v1`, re-trigger with a fresh event (close/reopen the PR), not
  "Re-run jobs".

## Adding a new shared workflow

1. `reusable-<name>.yml` here + a stub in `workflow-stubs/`.
2. Map the stub in `.github/sync.yml` (watch the per-group filename
   collisions documented there).
3. Merge, move `@v1`, merge the fan-out sync PRs.
4. If it should gate merges, add its context to the "Protect main" rulesets.
