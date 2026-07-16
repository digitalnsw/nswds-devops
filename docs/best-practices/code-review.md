# Code Review Strategy

CI proves a change is *valid*; review proves it's *right*. The org-level
"Copilot Review" ruleset gives every PR an automated first pass — treat its
comments as a linter with opinions, not as the review.

## What reviewers focus on (in order)

1. **Does the PR title say what will ship?** It becomes the commit, the
   version bump, and the changelog line. A mislabelled type is a review
   blocker ([Semantic Versioning](semantic-versioning.md)).
2. **Behaviour and blast radius** — especially anything in this repo, where
   one merge fans out to 21 repos, and anything touching release configs or
   workflows.
3. **Lockfile diffs.** Large lockfile changes deserve a skim: do they match
   the manifest change? GitHub renders lockfiles collapsed — expand them on
   bot PRs.
4. **Synced-file edits in consumer repos** — an edit to a DO-NOT-EDIT file
   will be silently overwritten; redirect it here.
5. Tests for changed behaviour ([Testing](testing.md)) and docs for changed
   contracts ([Documentation](documentation.md)).

## Practices

- Review promptly or hand off — with strict up-to-date checks, a PR that
  sits goes stale and re-runs CI after every "Update branch".
- Request changes with a reason and, where possible, a suggestion — reviews
  teach conventions.
- Bot PRs: the review is lighter but real — check the dependency's
  changelog for majors; Renovate includes it in the PR body.
- Self-merge after approval is fine; merging your own unreviewed PR is for
  emergencies (and shows up in the audit log either way).
