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
lockstep):

| Type | Description | Releases? |
| --- | --- | --- |
| `feat` | A new feature | minor |
| `fix` | A bug fix | patch |
| `perf` | Performance improvement | patch |
| `style` | Formatting/whitespace, no code change | patch |
| `refactor` | Code change that neither fixes nor adds | no |
| `test` | Adding or updating tests | no |
| `build` | Build tooling or external dependencies | no |
| `ops` | Operational/infrastructure changes (CI, workflows) | no |
| `docs` | Documentation-only changes | no |
| `chore` | Routine maintenance (deps, config) | no |
| `merge` | Merge bookkeeping | no |
| `revert` | Reverts a previous commit | no |

Examples:

```
feat(auth): add login endpoint
fix(ui): correct button spacing on mobile
docs(readme): clarify installation instructions
chore(deps): update axios to v1.3.1
refactor(api): simplify error handling
test(utils): add unit test for date parser
```

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
- Breaking: `type!: subject` **plus** a `BREAKING CHANGE:` footer that
  spells out the migration:

  ```
  feat(auth)!: remove legacy auth support

  BREAKING CHANGE: The `legacyLogin()` method has been removed.
  Use `newLogin()` instead.
  ```

- Reverts reference what they undo, in subject and body:

  ```
  revert: feat(auth): add login endpoint

  This reverts commit abc123.
  ```

- Bots are aligned, not exempted: Renovate commits as `chore(deps):`, the
  sync as `chore(ci):` — both pass the same lint. The only ignored pattern
  is the bot's own `chore(release): x.y.z [skip ci]` commit.
- Release runs export `HUSKY=0` so hooks don't lint the bot's changelog
  commit — a load-bearing line that has regressed before (tokens #94);
  leave it alone.
