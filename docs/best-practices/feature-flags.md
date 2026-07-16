# Feature Flag Strategy

> **Status: proposed baseline.** We have no org-wide flag platform today;
> this guide sets the conventions to use until/unless we adopt one, so that
> ad-hoc flags stay consistent and removable.

## When to use a flag

- Shipping incomplete work behind a dark switch so `main` stays releasable
  (preferred over long-lived feature branches — our whole pipeline assumes
  trunk-based flow with frequent small releases).
- Risky changes needing a fast kill switch that doesn't require a rollback
  release.
- Environment-scoped behaviour (preview vs production) that configuration
  alone can't express cleanly.

Do **not** use flags for permanent configuration — that's an env var or
config file ([Environments](environments.md)).

## Conventions

- **Implement as environment variables** with a common prefix:
  `FLAG_<AREA>_<NAME>` (e.g. `FLAG_SIGNUP_NEW_FORM`). Platform env vars
  (Vercel/Actions variables) are already per-environment, auditable, and
  need no new infrastructure.
- **Boolean, default-off, read in one place.** A flag read in one module is
  removable; a flag string-compared in twelve places is permanent.
- **Every flag has an owner and an expiry intent.** Record both in a
  `FLAGS.md` at the repo root: name, purpose, owner, added date, removal
  condition. A flag with no removal condition is configuration wearing a
  flag costume.
- **Removal is a `refactor:` PR** deleting the flag, the dead branch, and
  the `FLAGS.md` row. Review of any PR that *adds* a flag should ask "what
  deletes this?".
- Flag checks belong in code paths, not in CI workflows — CI behaviour
  toggles (like `CI_SKIP_BUILD`) are repo variables documented in
  [GitHub Actions](github-actions.md), not feature flags.

## If we outgrow this

Signals we need a real flag service (percentage rollouts, per-user
targeting, audit UI): more than ~a dozen live flags in a repo, or product
asking for gradual rollouts. Revisit this guide then.
