# Coding Practices

General expectations for code in any digitalnsw repo. Language-specific
style is delegated to the linters ([Linting & Formatting](linting-and-formatting.md));
this guide covers the practices tools can't fully check.

## Rules

- **Never edit synced files in a consumer repo.** Anything with a
  "Synced from digitalnsw/nswds-devops — DO NOT EDIT" header (workflows,
  `scripts/`, commitlint/release configs, `renovate.json`) is overwritten by
  the next sync. Change it here instead — see [MAINTENANCE.md](../../MAINTENANCE.md).
- **Pin the toolchain in the repo.** `.nvmrc` is the source of truth for
  Node; CI and the release pipeline read it. Don't rely on whatever Node a
  laptop happens to have — a lockfile regenerated on a different npm version
  is churn at best and breakage at worst.
- **Comments explain constraints, not mechanics.** The shared configs are
  full of LOAD-BEARING comments (e.g. the `breakingHeaderPattern` note in
  `release.config.mjs`, the `HUSKY: 0` note in the release workflow) — each
  one exists because removing the line silently broke a release. Follow that
  pattern: when a line is only correct for a non-obvious reason, say so where
  the line lives.
- **Committed build artefacts are the exception, not the rule.** Only commit
  `dist/` where the release process requires it (nswds-app), and keep it in
  sync — CI checks it (`check-npm-artifacts` / `check:dist`).
- **Small, reviewable changes.** One concern per PR; the squash-merge
  strategy means each PR becomes exactly one conventional commit on `main`
  and one changelog line.
- **No secrets in code or config**, ever — GitHub repo secrets for CI,
  platform env vars (e.g. Vercel) for runtime. See [Environments](environments.md).

## When in doubt

Match the surrounding code. Consistency within a repo beats personal
preference, and consistency across repos is what this folder is for.
