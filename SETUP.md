# One-time setup (manual steps)

These steps need org-admin access and can't be automated from a workstation.

## 0. Create the GitHub repo and push

✅ Done — created as `digitalnsw/nswds-devops` (2026-07-15).

## 1. GitHub App for the sync (recommended over a PAT — no expiry)

1. Org settings → Developer settings → **GitHub Apps** → New GitHub App
   - Name: `nswds-devops-sync` (anything unique)
   - Homepage URL: `https://github.com/digitalnsw/nswds-devops` (required field,
     informational only)
   - Uncheck *Webhook → Active* (not needed)
   - Repository permissions:
     - **Contents: Read and write**
     - **Pull requests: Read and write**
     - **Workflows: Read and write** ← required; without it every sync PR fails
       only on the `.github/workflows/` stub files
   - Where can this app be installed: *Only on this account*
2. Generate a **private key** (downloads a `.pem`).
3. **Install the app** on the org with **All repositories** — new repos are
   then covered automatically, and onboarding is a single sync.yml edit. The
   sync only ever opens PRs in repos explicitly listed in `.github/sync.yml`,
   so "all" doesn't mean it touches everything. Trade-off to remember: the
   app's private key (held only on nswds-devops) then grants org-wide write,
   so keep nswds-devops `main` branch-protected, and switch the installation
   to "Only select repositories" if the org ever gains a repo a sync bot must
   never touch.
4. On **this repo** (nswds-devops) → Settings → Secrets and variables → Actions
   — use the **Repository** level for both (not Organization: that would expose
   the org-wide-write key to every repo's workflows; not Environment: the sync
   job declares no `environment`, so it wouldn't resolve):
   - *Secrets* tab → **New repository secret** `SYNC_APP_ID` = the App ID
     (App settings page)
   - *Secrets* tab → **New repository secret** `SYNC_APP_PRIVATE_KEY` = full
     contents of the `.pem`

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
  (currently nswds-design, already set up); the release workflow picks it up
  automatically when present and uses the plain GITHUB_TOKEN otherwise.

  To add it to a newly protected repo (or run `/protect-branch`, which
  automates this):

  ```sh
  ssh-keygen -t ed25519 -f release-deploy-key -N "" -C "release-bot@<repo>"
  gh repo deploy-key add release-deploy-key.pub --repo digitalnsw/<repo> --title "release-bot" --allow-write
  gh secret set RELEASE_DEPLOY_KEY --repo digitalnsw/<repo> < release-deploy-key
  rm release-deploy-key release-deploy-key.pub
  ```

  Then add **Deploy keys** to the Bypass list of the repo's `main` ruleset so
  the release commit can push through the protection.

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

## 4b. Repos with required-status-check rulesets

Reusable workflows change check-context names: a job that used to report as
`commitlint` now reports as `commitlint / commitlint` (caller job / reusable
job). Any ruleset requiring the old name blocks PRs with "Expected — waiting
for status to be reported". Rename the required contexts accordingly
(nswds-design's "Protect main" was updated 2026-07-15; apply the same rename
to any future ruleset).

## 5. Per-repo cleanups to fold into each sync-PR review

- Delete the superseded commit-types file(s) — the synced
  `commitlint.config.mjs` imports `commit-types.mjs`, so the old ones are dead
  weight. Verified against remote main (2026-07-15):
  - attestation, nswds-email: `commit-types.js` AND `commit-types.cjs`
  - awards, engagement, reviewers, ictds-portal-flows, ictds-risk,
    nswds-images, nswds-public-sans, nswds-design, nswds-email-builder,
    nswds-ui: `commit-types.js`
  - nswds-tokens: `commit-types.cjs`
  - digitalnsw, nswds-email-starter, nswds-app, nswds-email-framework:
    nothing to delete
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
