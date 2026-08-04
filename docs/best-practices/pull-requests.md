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
- **Squash merge only**, enforced by repository settings — "Squash and
  merge" is the only method offered on every repo in the fleet. Merge
  commits and rebase-merges break the one-PR-one-commit-one-changelog-line
  model. This has a consequence for stacked branches; see
  [Stacked pull requests](#stacked-pull-requests).
- **Never hand-resolve lockfile conflicts in the web editor.** Update the
  branch; if the lockfile genuinely conflicts, regenerate it locally
  (`npm install`) or let the bot recreate the PR. The gate will catch a
  botched resolution, but not creating one is cheaper.
- **Bot PRs (Renovate, Snyk, repo-sync) are reviewed like any other PR** —
  the checks make them safe to merge, not safe to ignore. Two low-risk
  Renovate categories are exempt and merge themselves once every required
  check is green: devDependency patches and lock file maintenance
  ([Renovate → Automerge](renovate.md#automerge)). Everything else waits for
  a human.
- Draft PRs for work-in-progress; the AI title/description workflows fill in
  scaffolding on open, but **you own the final result** — review and edit the
  generated description so it summarises the change clearly, links related
  issues/tickets, and calls out any breaking changes or manual steps. Avoid
  vague titles like "final changes" or "fix stuff"; the title is the commit
  and the changelog line.
- Admin bypass is for emergencies, and every bypass should be explainable
  after the fact.

## Stacked pull requests

A stacked PR is one whose base is another open PR's branch rather than
`main` — the second change depends on the first, so it is opened against it
and retargeted to `main` when the first merges.

Squash merging makes this need one manual step. Squashing replaces the base
PR's commits with a single **new** commit on `main`; the original commits
never appear there. The stacked branch is still built on those originals, so
after the base merges its history has no common ancestor with `main` beyond
the point both branches diverged. GitHub retargets the stacked PR to `main`
and reports it as conflicting, even when the two changes do not overlap
textually.

The fix is to replay only the stacked commits onto the new `main`:

```sh
git fetch origin
git rebase --onto origin/main <base-branch-tip> <stacked-branch>
git push --force-with-lease
```

`<base-branch-tip>` is the commit the stacked branch was created from — the
head of the base PR's branch before it merged. Everything after it is
replayed; the base PR's own commits are dropped, because their content is
already on `main` in squashed form.

This normally applies without conflicts. Conflicts here mean the two changes
genuinely overlap, and should be resolved on their merits.

Do **not** merge `main` into the stacked branch instead. That reconciles two
whole-branch diffs rather than replaying the incremental commits, and
produces spurious conflicts across every file the base PR touched.

Confirm the rebase preserved the content that was reviewed:

```sh
git diff <pre-rebase-sha> HEAD -- <paths changed by the stacked PR>
```

Empty output means only the base has moved. Record the pre-rebase SHA before
starting; it is also the rollback point.

Because merging the base triggers a release on repositories that run
semantic-release, `main` often moves a second time moments later. Under
strict up-to-date checks the stacked PR then reports as behind and needs
**Update branch** — or a second rebase — before it can merge.

## Before you merge

- [ ] Title follows Conventional Commits and says what ships
- [ ] Branch follows the naming convention
- [ ] Related issues/tickets linked
- [ ] Tests added or updated for changed behaviour
- [ ] Documentation updated if a contract changed
- [ ] CI green and branch up to date with `main`
