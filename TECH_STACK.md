# digitalnsw Technology Stack

The technology stack across every repo covered by the nswds-devops fleet
tooling (the repos listed in [.github/sync.yml](.github/sync.yml), plus this
repo). Kept fleet-wide on purpose: not every repo uses every item, so the
annotations note where something is only used in a subset.

- ✅ in use today (verified against each repo's `package.json`/config,
  2026-07-19)
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
  consumed across the fleet
- ✅ [shadcn/ui](https://ui.shadcn.com/) — nswds-ui, ictds-risk; the
  cva/lucide component pattern is also used in awards, nswds-app,
  nswds-email
- ✅ [Radix UI](https://www.radix-ui.com/) — awards, nswds-app, nswds-email
  (also underpins shadcn/ui)
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

- ✅ [Auth.js (NextAuth)](https://authjs.dev/) — attestation, awards,
  engagement, nswds-email, reviewers
- ✅ [Better Auth](https://www.better-auth.com/) — nswds-app

## Database & ORM

- ✅ [Neon](https://neon.tech/) — awards, nswds-app, digitalnsw
- ✅ [Turso](https://turso.tech/) (libSQL) — attestation, engagement,
  nswds-email, reviewers
- ✅ [Drizzle ORM](https://orm.drizzle.team/) — the standard ORM wherever
  there's a database (6 repos)

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
