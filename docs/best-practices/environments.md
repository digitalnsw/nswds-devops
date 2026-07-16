# Environment Strategy

> **Status: partly enforced.** Toolchain pinning and secret handling are
> enforced; deploy-environment layout varies by app and platform (most apps
> deploy via Vercel).

## Toolchain: `.nvmrc` is the environment contract

Every workflow that installs dependencies reads `.nvmrc` first (with a
central fallback). This is deliberate: a lockfile regenerated on a newer
Node/npm than the repo uses is exactly the kind of drift the release
pipeline comment warns about. Local dev should `nvm use` the same file.

## Configuration and secrets

- **Secrets** live in GitHub repo secrets (CI) or the deploy platform's
  env vars (runtime) — never in the repo, never echoed in workflows.
  Repo-level over org-level where the credential is powerful (the sync App
  key is repo-scoped here for exactly that reason).
- **Non-secret CI behaviour toggles** are GitHub **repo variables**
  (`vars.*`), e.g. `CI_SKIP_BUILD=true` on app repos whose builds need
  deploy-time env. Variables are visible and auditable; secrets are not —
  don't put toggles in secrets.
- **Per-environment config** belongs to the platform (Vercel
  preview/production env vars), not to branches. One branch (`main`), many
  environments.

## Environment tiers (apps)

| Tier | Source | Purpose |
| --- | --- | --- |
| Preview | Every PR (Vercel) | Review the change with real env |
| Production | `main` after merge | The release |

- CI does **not** get production env: repos whose builds require it skip the
  CI build (`CI_SKIP_BUILD`) and rely on the platform build + preview for
  behavioural verification. The merge gate still validates integrity.
- A PR's preview deployment is part of review for user-facing changes —
  link it in the PR when the change is visual.

## Rules

- New required env var ⇒ document it (README or `.env.example`) and add it
  to the platform **before** merging the code that reads it.
- Never copy production secrets into CI to "make the build work" — that's
  what previews are for; rotate anything that leaks.
