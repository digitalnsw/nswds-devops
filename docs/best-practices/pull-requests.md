# Pull Request (PR) Strategy

Everything reaches `main` through a PR, and `main` is protected everywhere:
the "Protect main" ruleset blocks branch deletion and force-pushes and
requires **`commitlint / commitlint`** and **`install / install`** to pass
on the PR's test merge, with the branch **up to date with main** (strict
policy). Repository admins and the release deploy key are the only bypass
actors.

## What the gates buy us

- `install / install` checks out the *test merge* of PR + base and runs the
  conflict-marker grep, `npm clean-install`, and the build — so a bad
  conflict resolution or corrupted lockfile fails **before** it can land.
  This exists because a bot PR once merged committed conflict markers into a
  lockfile via the web "Resolve conflicts" editor; detection existed,
  enforcement didn't.
- Strict up-to-date closes the stale-branch loophole: a PR green against an
  old main must re-verify after "Update branch".

## Practices

- **One concern per PR** — it squash-merges to a single conventional commit;
  the title is the commit message ([Commit Messages](commit-messages.md)).
- **Squash merge only.** Merge commits and rebase-merges break the
  one-PR-one-commit-one-changelog-line model.
- **Never hand-resolve lockfile conflicts in the web editor.** Update the
  branch; if the lockfile genuinely conflicts, regenerate it locally
  (`npm install`) or let the bot recreate the PR. The gate will catch a
  botched resolution, but not creating one is cheaper.
- **Bot PRs (Renovate, Snyk, repo-sync) are reviewed like any other PR** —
  the checks make them safe to merge, not safe to ignore. No auto-merge on
  bot PRs until drift has been boring for a good while.
- Draft PRs for work-in-progress; the AI title/description workflows fill in
  scaffolding on open, but **you own the final result** — review and edit the
  generated description so it summarises the change clearly, links related
  issues/tickets, and calls out any breaking changes or manual steps. Avoid
  vague titles like "final changes" or "fix stuff"; the title is the commit
  and the changelog line.
- Admin bypass is for emergencies, and every bypass should be explainable
  after the fact.

## Before you merge

- [ ] Title follows Conventional Commits and says what ships
- [ ] Branch follows the naming convention
- [ ] Related issues/tickets linked
- [ ] Tests added or updated for changed behaviour
- [ ] Documentation updated if a contract changed
- [ ] CI green and branch up to date with `main`
