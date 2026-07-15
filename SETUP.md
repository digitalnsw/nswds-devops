# One-time setup (manual steps)

These steps need org-admin access and can't be automated from a workstation.

## 0. Create the GitHub repo and push

✅ Done — created as `digitalnsw/nswds-devops` (2026-07-15).

## 1. GitHub App for the sync (recommended over a PAT — no expiry)

1. Org settings → Developer settings → **GitHub Apps** → New GitHub App
   - Name: `nswds-devops-sync` (anything unique)
   - Uncheck *Webhook → Active* (not needed)
   - Repository permissions:
     - **Contents: Read and write**
     - **Pull requests: Read and write**
     - **Workflows: Read and write** ← required; without it every sync PR fails
       only on the `.github/workflows/` stub files
   - Where can this app be installed: *Only on this account*
2. Generate a **private key** (downloads a `.pem`).
3. **Install the app** on the org, selecting these repos: `nswds-devops`
   plus all consumer repos (digitalnsw, attestation, awards, engagement,
   reviewers, ictds-portal-flows, ictds-risk, images, nswds-app, nswds-tokens,
   nswds-ui, nswds-public-sans, nswds-email-framework, nswds-email-starter,
   nswds-email, nswds-design, nswds-email-builder).
4. On **this repo** (nswds-devops) → Settings → Secrets and variables → Actions:
   - Variable `SYNC_APP_ID` = the App ID (App settings page)
   - Secret `SYNC_APP_PRIVATE_KEY` = full contents of the `.pem`

Fallback: a fine-grained PAT with the same three permissions on the same repos
works too (pass it as `GH_PAT`), but it expires and breaks the sync silently.

## 2. Reusable-workflow access (required while this repo is private)

This repo → Settings → Actions → General → **Access** →
"Accessible from repositories owned by the organization".
Without this every consumer stub fails with "workflow was not found".

## 3. Secrets consumer repos need (mostly already in place)

- `OPENAI_API_KEY` — used by ai-pr-title / openai-pr-description / commit
  scripts. An org-level secret covers all repos at once.
- `RELEASE_DEPLOY_KEY` — only in repos whose main branch is ruleset-protected
  (currently nswds-design); the release workflow picks it up automatically.

## 4. Pilot → fan-out

1. Trigger **Sync shared files to repos** (workflow_dispatch) — only
   `reviewers` and `nswds-ui` are active in `.github/sync.yml`.
2. Review and merge the two sync PRs (checklist in the PR description of the
   nswds-ui prep PR).
3. Uncomment the remaining repos in `.github/sync.yml` in batches:
   - Batch 2: digitalnsw, attestation, nswds-email
   - Batch 3: awards, engagement, ictds-risk, images, nswds-public-sans,
     nswds-email-framework, nswds-email-starter, nswds-design,
     nswds-email-builder
   - Batch 4 (extra review): nswds-tokens, nswds-app, ictds-portal-flows
     (its release.yml is a Power Platform prod pipeline — group 4 maps the
     release stub to semantic-release.yml; double-check the PR diff)

## 5. Per-repo cleanups to fold into each sync-PR review

- Delete the superseded commit-types file (`commit-types.js` in most repos,
  `commit-types.cjs` in nswds-tokens + nswds-email) — the synced
  `commitlint.config.mjs` imports `commit-types.mjs`.
- Delete `opencommit.yml` in awards / engagement / reviewers / nswds-app if
  OpenCommit is no longer used.
- ictds-portal-flows: the old full `semantic-release.yml` is replaced by the
  stub; sanity-check the release still runs.

## 6. Later: tag v1

Once the fan-out is stable, tag `v1` here and change `@main` → `@v1` in
`workflow-stubs/*.yml` (one commit; the sync propagates it). Move the `v1`
tag only after CI is green — it changes CI for every repo at once.

## 7. Known copy-paste bugs to fix while touching repos (unrelated to sync)

- `nswds-community/package.json` name is "nswds-signature"
- `nswds-images/package.json` name is "ictds-portal-flows"
- Onboarding candidates currently outside the sync: data, nswds-community,
  nswds-signature, nswds-email-issues (need devDeps + husky setup first —
  see README "Onboarding a new repo")
