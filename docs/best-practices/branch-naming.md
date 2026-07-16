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

- **type** — one of (note: this list is *not* identical to commit types —
  `ops` is a commit type but not a branch type):

  | Type | Purpose |
  | --- | --- |
  | `feat` | New features or enhancements |
  | `fix` | Fixes for issues found in development or testing |
  | `hotfix` | Urgent fixes for production issues |
  | `release` | Release preparation (version bumps, final tweaks) |
  | `docs` | Documentation-only changes |
  | `build` | Build system / CI / tooling updates |
  | `test` | Tests, experiments, prototypes, exploratory work |
  | `refactor` | Non-functional restructuring or cleanup |
  | `style` | Formatting-only changes |
  | `chore` | Routine maintenance (deps, minor config) |
  | `export` | Platform exports (e.g. Power Platform solutions) |
  | `ai` `copilot` `cursor` `claude` `codex` | Branches authored by AI tooling |

- **slug** — lowercase alphanumerics; dots/hyphens only *between*
  alphanumerics (`release/v1.2.0` ✓, `feat/-bad-` ✗). Keep it short and
  specific — a reader should guess the change from the name; avoid vague
  slugs like `feat/updates`.
- Optional issue/ticket segment: `fix/issue/123/lockfile-repair`,
  `feat/ticket/ABC-456/add-login-button`.

Examples: `feat/shared-ci-gate`, `build/release-deploy-key`,
`docs/best-practice-guides`, `hotfix/fix-production-api-timeout`.

## Bot exemptions

Bots keep their native branch names; each has an explicit allowance in the
config: `dependabot/…`, `renovate/…`, `snyk-upgrade-<hash>`,
`alert-autofix-…`, and the file-sync's `chore/repo-sync…`. Adding a new bot
means adding a regex there — in this repo, synced everywhere — not
weakening the standard pattern.

## Practices

- Use `scripts/create-branch.sh` to create branches — it validates against
  the same regexes before you've written any code (and
  `scripts/suggest-branch-name.sh` can propose one). Both are documented in
  [Command Documentation](command-documentation.md).
- Branch type should match the eventual commit type (a `feat/…` branch
  merging as `fix:` is a smell that the scope changed — rename or split).
- Delete branches on merge; the rulesets block deletion of `main` itself.
