# digitalnsw Technology Stack

The technology stack across every repo covered by the nswds-devops fleet
tooling (the repos listed in [.github/sync.yml](.github/sync.yml), plus this
repo). Kept fleet-wide on purpose: not every repo uses every item, so the
annotations note where something is only used in a subset.

- ✅ in use today (verified against each repo's `package.json`/config,
  2026-07-19)
- ⚠️ in use today but migrating away — see the
  [Standardisation roadmap](#standardisation-roadmap)
- 🔍 discovery — not currently in use; parked for review (see
  [Discovery](#discovery))

## Core Framework

- ✅ [Next.js](https://nextjs.org/) — the standard app framework (13 repos)
- ✅ [React](https://react.dev/)
- ✅ [TypeScript](https://www.typescriptlang.org/)

## Styling & UI Frameworks

- ✅ [Tailwind CSS V4](https://tailwindcss.com/) — fleet-wide (16 repos)
- ✅ [NSW Design System](https://designsystem.nsw.gov.au/) — via the
  `@nswds/*` packages built in nswds-ui / nswds-app / nswds-tokens and
  consumed across the fleet. nswds-ui is the newer generation and
  supersedes nswds-app.
- ✅ [Base UI](https://base-ui.com/) — the headless primitive layer for
  `@nswds/ui` (nswds-ui). Replaces Radix UI as nswds-ui supersedes
  nswds-app.
- ✅ [shadcn/ui](https://ui.shadcn.com/) — component pattern and CLI;
  nswds-ui distributes `@nswds/ui` components through its own shadcn
  registry (`apps/registry`). Also ictds-risk, and the cva/lucide pattern
  in awards, nswds-app, nswds-email
- ✅ [Radix UI](https://www.radix-ui.com/) — awards, nswds-app, nswds-email.
  Legacy-generation primitives: being superseded by Base UI as nswds-ui
  replaces nswds-app
- ✅ [next-themes](https://github.com/pacocoursey/next-themes) — dark-mode
  theming (6 repos)
- ✅ [Sass](https://sass-lang.com/) — nswds-tokens build pipeline only

## Testing & Component Development

- ✅ [Storybook](https://storybook.js.org/) — nswds-app, nswds-ui
- ✅ [Vitest](https://vitest.dev/) — nswds-app, nswds-tokens, nswds-ui
- ✅ [Playwright](https://playwright.dev/) — nswds-app,
  nswds-email-framework

## Build & Developer Tools

- ✅ [ESLint](https://eslint.org/)
- ✅ [Prettier](https://prettier.io/)
- ✅ [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  — enforced fleet-wide by the shared
  [commitlint](https://commitlint.js.org/) config +
  [husky](https://typicode.github.io/husky/) hooks
  ([Commit Messages](docs/best-practices/commit-messages.md))
- ✅ [Git Conventional Commits](https://github.com/qoomon/git-conventional-commits)
  — the synced `git-conventional-commits.yaml`, kept in lockstep with
  `commit-types.mjs`
- ✅ [Semantic Versioning 2.0.0](https://semver.org/) +
  [semantic-release](https://github.com/semantic-release/semantic-release)
  — automated releases and changelogs in every repo
  ([Releases](docs/best-practices/releases.md))
- ✅ [platisd/openai-pr-description GitHub Action](https://github.com/platisd/openai-pr-description)
  — autofills PR descriptions (synced stub, SHA-pinned)
- ✅ AI commit / branch / PR-title tooling — the shared scripts in this repo
  (`npm run commit`, `npm run branch:suggest`, ai-pr-title workflow),
  calling the OpenAI API directly with secret redaction

## Fleet Automation (nswds-devops)

The layer this repo provides to every other repo — see
[README](README.md) and [MAINTENANCE.md](MAINTENANCE.md):

- ✅ [repo-file-sync-action](https://github.com/BetaHuhn/repo-file-sync-action)
  — propagates shared scripts/configs/workflow stubs as reviewable PRs
  (SHA-pinned; driven by a dedicated GitHub App)
- ✅ Reusable GitHub Actions workflows — CI logic lives here once, consumed
  via thin synced stubs pinned to the floating `v1` tag
  ([GitHub Actions](docs/best-practices/github-actions.md))
- ✅ [mark](https://github.com/kovetskiy/mark) — publishes
  `docs/best-practices/**` to Confluence on every merge to `main`
  (read-only mirror, version+checksum pinned)

## Security & Dependency Management

- ✅ [Snyk](https://snyk.io/) — security scanning and Critical/High fix PRs
- ✅ [Renovate](https://docs.renovatebot.com/) (Mend GitHub App) — routine
  dependency updates fleet-wide, policy in this repo's `default.json`
  ([Renovate](docs/best-practices/renovate.md))

## CI/CD & Deployment

- ✅ [GitHub Actions](https://github.com/features/actions)
- ✅ [Vercel](https://vercel.com/) — app hosting and functions (nswds-app,
  nswds-email, digitalnsw forms backend, and others)
- ✅ [Microsoft Power Platform](https://www.microsoft.com/en-au/power-platform)
  — ictds-portal-flows (bespoke production deploy pipeline; never
  overwritten by the sync)

## Auth & Access Management

Standard going forward: **Better Auth** (reference implementation:
nswds-app).

- ✅ [Better Auth](https://www.better-auth.com/) — nswds-app, reviewers,
  attestation; the fleet standard for all new and migrated auth
- ⚠️ [Auth.js (NextAuth)](https://authjs.dev/) — awards,
  engagement, nswds-email; every one is on the v5 **beta**
  (`5.0.0-beta.x`). Migrating away → Better Auth

## Database & ORM

Standard going forward: **Neon Postgres + Drizzle ORM**.

- ✅ [Neon](https://neon.tech/) (Postgres) — awards, nswds-app, digitalnsw,
  reviewers, attestation; the fleet standard for all new and migrated
  databases
- ⚠️ [Turso](https://turso.tech/) (libSQL) — engagement,
  nswds-email. Migrating away → Neon Postgres
- ✅ [Drizzle ORM](https://orm.drizzle.team/) — the standard ORM wherever
  there's a database (6 repos). Spans both database stacks (libsql and
  neon drivers), so it survives the migration: repos swap dialect and
  driver, not ORM

## Standardisation roadmap

Decisions (2026-07-19): consolidate every database on **Neon Postgres**
and every auth stack on **Better Auth** (Drizzle adapter). Drivers: half
the fleet is already on Neon; Auth.js has the whole fleet sitting on a
v5 beta; and one database + one auth stack means one operational
playbook (branching, backups, migrations, session handling) instead of
two. nswds-app is the reference implementation — it already runs the
full target stack (Better Auth + Neon + Drizzle).

| Repo | Database today | Auth today | To migrate | Tracking |
| --- | --- | --- | --- | --- |
| reviewers | Neon ✅ | Better Auth ✅ | — (migrated 2026-07-23) | [reviewers#252](https://github.com/digitalnsw/reviewers/issues/252) (the playbook — full detail lives here) |
| engagement | Turso | Auth.js v5 beta | database + auth | [engagement#218](https://github.com/digitalnsw/engagement/issues/218) |
| attestation | Neon ✅ | Better Auth ✅ | — (migrated 2026-07-23) | [attestation#188](https://github.com/digitalnsw/attestation/issues/188) |
| nswds-email | Turso | Auth.js v5 beta (3 providers: credentials + magic link + Entra) | database + auth + its Turso-coupled test harness; planned as three PRs | [nswds-email#465](https://github.com/digitalnsw/nswds-email/issues/465) |
| awards | Neon ✅ | Auth.js v5 beta (credentials + email-OTP MFA + magic link + Entra) | auth only, in place | [awards#56](https://github.com/digitalnsw/awards/issues/56) |
| nswds-app | Neon ✅ | Better Auth ✅ | — (reference) | — |
| digitalnsw | Neon ✅ | — | — | — |

Rows are in execution order: the three SSO-only template clones first
(reviewers proves the playbook, engagement and attestation repeat it),
then the two complex-auth repos. Each issue is a full scope — current
state, work items, data mapping, cutover/rollback, risks, sizing.

Migrate database and auth **together per repo**: doing the database
first would convert Auth.js's user/account/session tables to Postgres
only to reshape the same tables again for Better Auth. One change window
per repo touches them once.

## Email Infrastructure

- ✅ [React Email](https://react.email/)
- ✅ [Resend](https://resend.com/)

## Discovery

Not currently in use anywhere on the fleet. Parked here for review — either
candidates to adopt, or items from the previous version of this document
that verification (2026-07-19) found no longer/never in use.

### Candidates to adopt

- 🔍 [Sanity](https://www.sanity.io/) — headless CMS. Not used yet;
  earmarked for evaluation as the content layer for future work.
- 🔍 [Sentry](https://sentry.io/) (or equivalent) — error monitoring.
  Currently **no repo has any runtime error tracking**; the biggest gap
  in the stack. One org, a project per repo, config delivered via the
  file-sync like the rest of the shared tooling.
- 🔍 Fleet test gate — a `test` job in the shared `reusable-ci.yml` that
  runs `npm test` where the script exists and skips where it doesn't.
  Today only the design-system repos and nswds-email have tests, and CI
  runs none of them; this lets coverage grow repo-by-repo without a
  fleet-wide mandate.
- 🔍 Accessibility automation —
  [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) in
  the repos that already run Playwright, and Storybook's
  [a11y addon](https://storybook.js.org/addons/@storybook/addon-a11y) in
  nswds-ui. axe currently exists only in nswds-email-framework, while
  every property carries WCAG 2.2 AA obligations.
- 🔍 Environment validation at build time —
  [@t3-oss/env-nextjs](https://env.t3.gg/) (zod is already in all six
  app repos). Turns missing-secret failures from runtime 500s into
  build-time errors; pairs naturally with the Neon/Better Auth migration
  since every repo's `DATABASE_URL` and auth secrets change anyway.
- 🔍 [Vercel Analytics](https://vercel.com/analytics) fleet-wide — today
  only awards and nswds-email have it; decide deliberately whether
  that's policy or drift.

### Previously listed, not found in use — review before deleting

- 🔍 [Prisma](https://www.prisma.io/) — no repo uses it; Drizzle ORM is the
  de-facto standard everywhere a database appears.
- 🔍 [Dependabot](https://github.com/dependabot) — replaced by Renovate
  (routine updates) + Snyk (security). Only the branch-naming exemption for
  `dependabot/…` branches remains in the shared tooling.
- 🔍 [OpenCommit](https://github.com/di-sukharev/opencommit) — replaced by
  the shared AI commit scripts (`npm run commit`); only its
  `.opencommitignore` file format survives, reused by those scripts.
- 🔍 [conventional-changelog-cli](https://github.com/conventional-changelog/conventional-changelog)
  — replaced by semantic-release's changelog pipeline
  (`@semantic-release/changelog` + release-notes-generator).
- 🔍 [Cloudflare](https://www.cloudflare.com/en-au/) — the only usage found
  in code is optional Cloudflare Turnstile spam protection on the
  digitalnsw forms backend; no CDN/Workers/DNS usage appears in any repo.
  If Cloudflare still fronts DNS for any domain, that lives outside the
  repos — verify before treating it as retired.
