# Commit Message Strategy

Conventional Commits, enforced twice: locally by the husky `commit-msg`
hook, and authoritatively by the required `commitlint / commitlint` check on
every PR (the local hook can be bypassed; the CI check cannot).

## Format

```
<type>[(scope)][!]: <subject>

[body]

[BREAKING CHANGE: <migration notes>]
```

**Allowed types** (source of truth: [`commit-types.mjs`](../../commit-types.mjs),
synced everywhere; the `commit-types-sync` check keeps the YAML mirror in
lockstep): `feat fix refactor perf style test build ops docs chore merge
revert`.

## Why it matters more here than usual

Because every PR **squash-merges** with its title as the commit message,
and semantic-release reads those commits:

- the type decides whether a release ships and its bump
  ([Semantic Versioning](semantic-versioning.md));
- the subject becomes the changelog line verbatim
  ([Changelog Management](changelog-management.md)).

Write the PR title as the changelog entry you want users to read.

## Practices

- Subject: imperative, lower-case, no trailing period — "add shared CI
  merge gate", not "Added the CI gate.".
- Scope when it helps navigation: `feat(sync): …`, `chore(deps): …`.
- Breaking: `type!: subject` **plus** a `BREAKING CHANGE:` footer.
- Bots are aligned, not exempted: Renovate commits as `chore(deps):`, the
  sync as `chore(ci):` — both pass the same lint. The only ignored pattern
  is the bot's own `chore(release): x.y.z [skip ci]` commit.
- Release runs export `HUSKY=0` so hooks don't lint the bot's changelog
  commit — a load-bearing line that has regressed before (tokens #94);
  leave it alone.
