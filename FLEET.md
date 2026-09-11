# Fleet register

The single source of truth for every repository in the `digitalnsw` GitHub
organisation that this tooling covers, plus the org repositories it does not.
Everything here is derived from the repositories themselves (`package.json`,
workflows, rulesets, the sync map) and from the GitHub, npm and Vercel
consoles. When this file and a repository disagree, the repository is right
and this file needs updating.

The counts and the membership list below are held to `.github/sync.yml` and
`snyk-policy/repos.json` by `tools/fleet-docs.test.mjs`, so adding a repo to
the sync without updating this file fails CI. Everything else here — what a
repo is for, where it deploys, which checks it requires — is unguarded prose
that has to be re-verified by hand.

Related documents: [README.md](README.md) (how the shared tooling works),
[ONBOARDING.md](ONBOARDING.md) (adding a repo), [MAINTENANCE.md](MAINTENANCE.md)
(operating it), [TECH_STACK.md](TECH_STACK.md) (what the fleet is built with).

## Fleet at a glance

| Measure | Value |
|---|---|
| Consumer repos in [.github/sync.yml](.github/sync.yml) | 28 |
| Repos under the canonical Snyk policy ([snyk-policy/repos.json](snyk-policy/repos.json)) | 29 (the 28 consumers plus this repo) |
| Repos publishing to npm | 6 (`@nswds/ui`, `@nswds/tokens`, `@nswds/app`, `@nswds/eslint-config`, `@nswds/prettier-config`, `@nswds/metadata`) |
| Repos deployed on Vercel (team "Digital NSW", Pro plan) | 15 repos, 20 projects |
| Node baseline | `.nvmrc` `24.16.0`; `engines.node` `^22.22.2 \|\| >=24.15.0`; `engine-strict=true` |
| Org repos outside the fleet | 3 active (`ai-type-selector`, `commitments-dashboard`, `nswds-skills`), 1 R package (`nswtheme`), 6 public learning/archive repos, 5 archived |

## Fleet members

Every repo below carries the synced tooling, the shared CI stubs pinned to
`@v1`, a "Protect main" ruleset with `DeployKey` as the only bypass actor,
Renovate via the org preset, and the canonical Snyk policy block. The
**Sync group** column is the group in `.github/sync.yml`; **Required checks**
lists only what differs from the standard seven (`commitlint / commitlint`,
`install / install`, `install / lint`, `install / test`, `install / format`,
`security/snyk (DigitalNSW)`, `code/snyk (DigitalNSW)`).

### Applications (Next.js)

All but `agile` and `nswds-email-builder` deploy on Vercel; those two have no
Vercel project and no live URL.

| Repo | Purpose | Live URL | Stack notes | Sync group | Required checks (delta) |
|---|---|---|---|---|---|
| `agile` | Next.js application using the Vercel AI SDK with Azure OpenAI. README is empty; purpose is not documented in the repo | — | Next 16, `@nswds/ui` 6, `@nswds/tokens` 5, `ai` + `@ai-sdk/azure` | 1 | + `install / typecheck` |
| `attestation` | Digital Restart Fund (DRF) attestation application | https://projects.digital.nsw.gov.au | Next 16, `@nswds/app` 5 + `@nswds/ui` 6, Better Auth, Drizzle + Neon, Resend, Vitest | 1 | standard |
| `awards` | Awards nomination and judging application | https://awards.digital.nsw.gov.au | Next 16, `@nswds/app` 5, Better Auth, Drizzle + Neon, Vercel Analytics | 1 | standard |
| `engagement` | Engagement application | https://engagement.digital.nsw.gov.au | Next 16, `@nswds/app` 5, Better Auth, Drizzle + Neon, Resend, Vitest | 1 | standard |
| `reviewers` | ICT Project Assurance expert reviewer application | https://reviewers.digital.nsw.gov.au | Next 16, `@nswds/app` 5, Better Auth, Drizzle + Neon, Resend, Vercel Blob | 1 | standard |
| `nswds-email` | NSW Email Toolkit documentation site, component showcase and signature builder | https://email.digital.nsw.gov.au | Next 16, `@nswds/app` 5 + `@nswds/ui` 6, Better Auth, Drizzle + Neon, PostHog, Vercel Analytics; bespoke editorial, soft-404 and variant-HTML guard workflows | 1 | + `install / typecheck` |
| `nswds-design` | Documentation site for `@nswds/tokens`: every token by name, value and use, with colour tools | https://design.digital.nsw.gov.au | Next 16, `@nswds/ui` 6, Vitest 5 | 1 | standard |
| `nswds-community` | Community site | https://community.digital.nsw.gov.au | Next 16 | 1 | standard |
| `data` (local folder `nswds-data`) | Data site | https://data.digital.nsw.gov.au | Next 16 | 1 | standard |
| `nswds-public-sans` | Download and specimen site for Public Sans, the NSW masterbrand typeface | — (Vercel project `nswds-public-sans`) | Next 16, `@nswds/ui` 6, PostHog, Vercel Analytics | 1 | standard |
| `nswds-signature` | Email signature generator | https://signature.digital.nsw.gov.au | Next 16 | 1 | standard |
| `nswds-email-builder` | Email builder: Next.js front end over Maizzle 6 (Vue) templates. Superseded by the `apps/builder` workspace in `nswds-email-design` | — (no Vercel project) | Next 16, `@nswds/ui` 6, `@maizzle/framework` 6, Vue 3 | 1 | standard |
| `risk-guidance` | Risk assessment guidance tool | https://risk-guidance.vercel.app | Next 16, `@nswds/ui` 6 | 1 | standard, **no Snyk contexts** (see open issues) |

### Design system and shared packages (publish to npm)

| Repo | Publishes | Purpose | Deploys | Sync group | Required checks (delta) |
|---|---|---|---|---|---|
| `nswds-ui` (public) | `@nswds/ui` 7.0.2 | Design system source monorepo: the `@nswds/ui` package (Base UI primitives, shadcn pattern) plus a shadcn registry, Storybook and a docs site. Turborepo workspaces `apps/*`, `packages/*`; only `packages/ui` publishes | Vercel: `nswds-ui-web`, `nswds-ui-storybook`, `nswds-ui-registry`; Chromatic visual regression | 2a (own `release.yml` + release config, `.npmrc` variant) | + `install / typecheck`, `Lint, Typecheck & Storybook a11y` |
| `nswds-tokens` (public) | `@nswds/tokens` 5.0.0 | Design tokens (colour, spacing, typography, and so on) for CSS, SCSS, Less, JS/TS, JSON, Tailwind, Figma and DTCG; Figma sync workflows | — | 2b (own `release.yml`, release config and `ci.yml`; shared gate lands as `shared-ci.yml`) | + `Check dist artifacts`, `Lockfile`, `Package surface`, `Typecheck`, `Validate tokens` |
| `nswds-app` | `@nswds/app` 5.0.1 | Previous-generation application design system (Radix primitives, Storybook). Superseded by `@nswds/ui`; still consumed by attestation, awards, engagement, nswds-email and reviewers | Vercel: `nswds-app`, `nswds-app-storybook` | 3 (own release config, stock release stub) | standard |
| `nswds-eslint-config` (public) | `@nswds/eslint-config` 1.1.2 | Shared ESLint flat config: `.` entry point for Next.js apps, `./base` for everything else | — | 2c | + `Config smoke test` |
| `nswds-prettier-config` (public) | `@nswds/prettier-config` 1.0.1 | Shared Prettier options | — | 2c | + `Config smoke test` (ruleset is named "Protect default branch") |
| `nswds-metadata` (public) | `@nswds/metadata` 1.1.2 | Shared Next.js App Router metadata, viewport and web manifest | — | 2c | `Package smoke test`; **no Snyk contexts** (see open issues) |

### Email toolkit

| Repo | Purpose | Deploys | Sync group | Required checks (delta) |
|---|---|---|---|---|
| `nswds-email-design` | Next-generation email toolkit monorepo: the `@nswds/email` Maizzle 6 framework (`packages/email`, not yet published), its docs site, the email builder and the signature app. Turborepo; Playwright + axe visual and accessibility suites | Vercel: `nswds-email-design-docs`, `nswds-email-design-builder`, `nswds-email-design-signature` | 2d (own `release.yml` + release config, `.npmrc` variant) | + `install / typecheck`, `license/snyk (DigitalNSW)` |
| `nswds-email-framework` | Maizzle 5 email framework with components, layouts and build tools; Playwright visual regression, axe and Lighthouse accessibility suites. Tailwind 3 by design (Maizzle 5); majors blocked in Renovate | — | 1 | standard |
| `nswds-email-starter` | Maizzle 5 starter kit for NSW-branded HTML email. Tailwind 3 by design; majors blocked in Renovate | — | 1 | standard |
| `nswds-email-issues` (public) | Public issue tracker for the NSW Email Toolkit; no source code | — | 1 | **no Snyk contexts** (repo is not imported into Snyk) |

### Infrastructure, platform and static content

| Repo | Purpose | Deploys | Sync group | Required checks (delta) |
|---|---|---|---|---|
| `dtl-sandbox` | Azure sandbox stack in Pulumi TypeScript (Static Web App, storage, Application Insights) | Manual `pulumi up` from operator machines; `pulumi-preview.yml` is inert until the `PULUMI_PREVIEW_ENABLED` repo variable is set | 1 | + `install / typecheck`, `preview`; ruleset also has a `RepositoryRole` bypass actor (see open issues) |
| `ictds-portal-flows` | Power Platform solution `ictdsportalflows` (Power Automate flows and admin canvas app for the ICT/DS Sourcing Portal). `release.yml` is the production deploy; `export.yml` pulls the solution from Dev via the `ictds-export-bot` App. Publishes `docs/` and `README.md` to Confluence | Power Platform | 4 (release stub lands as `semantic-release.yml`) | standard |
| `digitalnsw` | Scraped static mirror of digital.nsw.gov.au with a forms API backend (`api/`, Neon, Resend, optional Cloudflare Turnstile) | GitHub Pages and Vercel project `digitalnsw` | 1 | standard |
| `images` (local folder `nswds-images`) | Static image and icon assets | GitHub Pages (https://digitalnsw.github.io/images/) | 1 | `install / *` + `commitlint` + `code/snyk` only (see open issues) |
| `share` | Static HTML hosting for proofs of concept; publishes `README.md` to Confluence | GitHub Pages (https://digitalnsw.github.io/share/) | 1 | standard |
| `nswds-devops` (public) | This repo: the shared tooling, reusable workflows, Renovate preset, Snyk policy and fleet documentation | — | source | standard + `shellcheck`, `workflow-lint`; second ruleset "Protect v tags" |

## Organisation repos outside the fleet

These are in the `digitalnsw` org but not in `.github/sync.yml`. None has
branch protection beyond the org-level "Copilot Review" ruleset, and none
has auto-merge or branch auto-delete enabled.

| Repo | What it is | Why it is outside |
|---|---|---|
| `ai-type-selector` | SharePoint Framework (SPFx) web part for triaging AI approaches against the NSW AI Assessment Framework; heft toolchain, React 17, Node 22 | SPFx toolchain is incompatible with the fleet Node floor and gates; no npm-based CI |
| `commitments-dashboard` | NSW Digital Strategy commitments dashboard: an SPFx web part over SharePoint list data, plus infra notes, reports and exports. No `package.json` at the root | Not an npm project at the root |
| `nswds-skills` (public) | Agent skills for product development workflows, installable via skills.sh | Markdown-only; no build |
| `nswtheme` (public) | R package for NSW-styled visualisations | R, not Node |
| `nsw-design-system` (public) | The NSW Design System toolkit repo | Separately governed |
| `accessibility-in-digital-procurement`, `accessibility-testing-basics`, `creating-accessible-documents`, `fundamentals-of-digital-accessibility` (public) | Accessibility learning modules | Static learning content, no active development |
| `digital-nsw-figma-archive` (public) | Figma backup of previous design-system versions | Archive |
| `nsw-design-system-react`, `nsw-design-system-v2`, `nsw-design-system-web-components`, `nsw-ds-drupal-kit`, `public-sans` | Archived | Archived on GitHub |

## Shared services and installations

| Service | Scope | Notes |
|---|---|---|
| GitHub App `nswds-devops-sync` | Installed org-wide (all repositories) | Drives the file sync, the Snyk policy fan-out and the weekly canaries. Credentials are repository secrets on this repo (`SYNC_APP_ID`, `SYNC_APP_PRIVATE_KEY`) |
| GitHub App `renovate` (Mend) | Installed on **selected** repositories | The selection list cannot be read with a user token; confirm new repos are selected at https://developer.mend.io/github/digitalnsw |
| GitHub App `snyk-io-au` | Installed org-wide | Posts `code/`, `security/` and `license/snyk (DigitalNSW)` statuses on PR heads for repos imported into the `digitalnsw` Snyk org |
| GitHub App `ictds-export-bot` | Selected repositories | Power Platform solution export for `ictds-portal-flows` |
| GitHub Apps `vercel`, `vercel-nswds-integration` | Org-wide | Preview and production deployments |
| Vercel team "Digital NSW" | 20 projects | See the Deploys columns above |
| Confluence (GDS space, https://dsia.atlassian.net/wiki) | Opt-in per repo | Manifests exist in `nswds-devops`, `ictds-portal-flows` and `share` |
| Org secrets | `AI_GATEWAY_API_KEY`, `AZURE_OPENAI_API_KEY` (all repos); `CONFLUENCE_USER`, `CONFLUENCE_TOKEN` (selected repos) | Org variable `AZURE_OPENAI_ENDPOINT` is set; `AZURE_OPENAI_DEPLOYMENT`, `AI_MODEL` and `AI_PROVIDER` fall back to workflow defaults |

## Local clones

The GitHub slug is the identity used in `.github/sync.yml` and
`snyk-policy/repos.json`. Two local folder names differ from their slug:
`nswds-data` is `digitalnsw/data` and `nswds-images` is `digitalnsw/images`.

## Open issues

**Four repos allow merge commits and rebase merges.** `agile`,
`nswds-email-design`, `nswds-metadata` and `risk-guidance` have
`allow_merge_commit` and `allow_rebase_merge` enabled. The fleet standard is
squash-only, because every PR must become exactly one conventional commit on
`main`. Fix:

```sh
gh api -X PATCH repos/digitalnsw/<repo> -F allow_merge_commit=false -F allow_rebase_merge=false
```

**Snyk merge gates are missing on four repos.** `risk-guidance` and
`nswds-metadata` receive all three Snyk statuses on PR heads but their
rulesets do not require `security/snyk (DigitalNSW)` or
`code/snyk (DigitalNSW)`. `images` requires `code/snyk` only. `nswds-email-issues`
receives no Snyk statuses at all, so it has not been imported into the Snyk
org. Fix: import `nswds-email-issues` in the Snyk console, then add the two
contexts to each ruleset as in ONBOARDING.md step 10.

**`dtl-sandbox` has a `RepositoryRole` bypass actor.** Fleet policy is that
the release deploy key is the only bypass actor on every ruleset
(MAINTENANCE.md, ruleset bypass policy). Fix: remove the role actor from the
"Protect main" ruleset.

**Thirteen fleet repos have no usable `README.md`.** Eleven ship a zero-byte
file — `agile`, `attestation`, `awards`, `engagement`, `reviewers`,
`nswds-community`, `data`, `nswds-design`, `nswds-signature`,
`nswds-email-builder` and `risk-guidance` — and `digitalnsw` and `images`
have no README at all. Every repo README should answer what it is, how to
run it, how to test it and where it deploys
([Documentation](docs/best-practices/documentation.md)).

**Every `@nswds/ui` consumer is a major version behind.** `@nswds/ui` 7.0.2
is published, but all eight consuming repos declare `^6.0.0`: `agile`,
`attestation`, `nswds-design`, `nswds-email`, `nswds-email-builder`,
`nswds-public-sans`, `risk-guidance`, and the `apps/*` and
`packages/site-chrome` workspaces of `nswds-email-design`. (`nswds-ui`'s own
`apps/*` resolve the workspace copy through `*`, so they are always on the
version they build and are not part of this.) A caret range
cannot cross a major, so Renovate raises this as an individual major PR per
repo rather than in the weekly group, and each one is waiting for a human.
Until they land, the fleet is running v6 against a v7 design system, and any
fix shipped in 7.x reaches nobody. Fix: work the major PRs, taking one repo
through first to establish the migration.

**`@nswds/app` is superseded but still consumed.** `attestation`, `awards`,
`engagement`, `nswds-email` and `reviewers` depend on `@nswds/app` 5;
`@nswds/ui` is the current generation. No migration is scheduled.

**`nswds-ui` is public but still publishes without provenance.** Its `.npmrc`
variant keeps `provenance=false` for a private-repo failure that no longer
applies. See the decision entry in MAINTENANCE.md.
