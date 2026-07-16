# Branch Naming Strategy

Branch names follow Conventional Branch and are **enforced on every PR** by
the `check-branch-name / check-branch-name` check. The single source of
truth is [`scripts/branch-name-config.sh`](../../scripts/branch-name-config.sh)
(synced to every repo; CI sources it from the **PR base commit**, so a PR
cannot loosen the policy that judges it).

## Format

```
<type>[/issue/<id>|/ticket/<id>]/<slug>
```

- **type** — one of: `feat fix hotfix release docs build test refactor
  style chore export ai copilot cursor claude codex`
  (note: this list is *not* identical to commit types — `ops` is a commit
  type but not a branch type).
- **slug** — lowercase alphanumerics; dots/hyphens only *between*
  alphanumerics (`release/v1.2.0` ✓, `feat/-bad-` ✗).
- Optional issue/ticket segment: `fix/issue/123/lockfile-repair`.

Examples: `feat/shared-ci-gate`, `build/release-deploy-key`,
`docs/best-practice-guides`.

## Bot exemptions

Bots keep their native branch names; each has an explicit allowance in the
config: `dependabot/…`, `renovate/…`, `snyk-upgrade-<hash>`,
`alert-autofix-…`, and the file-sync's `chore/repo-sync…`. Adding a new bot
means adding a regex there — in this repo, synced everywhere — not
weakening the standard pattern.

## Practices

- Use `scripts/create-branch.sh` to create branches — it validates against
  the same regexes before you've written any code.
- Branch type should match the eventual commit type (a `feat/…` branch
  merging as `fix:` is a smell that the scope changed — rename or split).
- Delete branches on merge; the rulesets block deletion of `main` itself.
