# digitalnsw Technology Stack

What the fleet is built with: every repo covered by the nswds-devops tooling
(the 28 consumers in [.github/sync.yml](.github/sync.yml) plus this repo).
Counts are the number of repos declaring the package in a root or workspace
`package.json`; a per-repo breakdown is in [FLEET.md](FLEET.md). Not every
repo uses every item, so each entry says where it applies.

## Standards

The fleet standard for a new application is: Next.js App Router on Vercel,
`@nswds/ui` + `@nswds/tokens` + `@nswds/metadata`, Tailwind CSS 4, Better
Auth, Neon Postgres with Drizzle ORM, Resend with React Email, Vitest, and
the shared lint, format, commit and release tooling from this repo.

No single repo runs all of that on the current component generation, so read
the reference in two halves:

- **Data, auth and email** — nswds-app is the reference implementation. It is
  the only repo running the full target stack (Better Auth + Neon + Drizzle,
  with React Email and Resend), and attestation, awards, engagement,
  nswds-email and reviewers repeat the same shape. All six still build their
  UI on `@nswds/app`, which `@nswds/ui` supersedes.
- **UI and tooling** — the content sites (agile, risk-guidance, nswds-design,
  nswds-public-sans, data, nswds-community, nswds-signature) are the current
  shape of the component and toolchain layer: `@nswds/ui`, `@nswds/tokens`,
  `@nswds/metadata` and Tailwind 4 on Next 16. None of them has a database,
  auth or transactional email, so do not read them as a full-stack model.

A new application therefore takes its UI layer from a content site and its
data, auth and email layer from nswds-app.

## Core framework

| Technology | Where | Notes |
|---|---|---|
| [Next.js](https://nextjs.org/) 16 | 14 application repos, plus the workspace apps in nswds-ui and nswds-email-design | App Router; `babel-plugin-react-compiler` enabled in 13 repos |
| [React](https://react.dev/) 19 | every Next.js repo | |
| [TypeScript](https://www.typescriptlang.org/) 5 | every Node repo except the shell-only ones | dtl-sandbox runs TypeScript 6; Renovate blocks TypeScript majors fleet-wide because Next.js and typescript-eslint do not yet support 6/7 |

## Styling and UI

| Technology | Where | Notes |
|---|---|---|
| [Tailwind CSS](https://tailwindcss.com/) 4 | 16 repos | via `@tailwindcss/postcss`; `prettier-plugin-tailwindcss` and `prettier-plugin-organize-imports` in the same repos |
| Tailwind CSS 3 | nswds-email-framework, nswds-email-starter | Required by Maizzle 5; majors blocked in Renovate for these two repos by owner decision |
| [NSW Design System](https://designsystem.nsw.gov.au/) via `@nswds/*` | fleet-wide | Versions below are what consumers declare, not what is published. `@nswds/tokens` `^5` (15 repos), `@nswds/metadata` `^1` (14 repos), `@nswds/app` `^5` (5 repos; superseded by `@nswds/ui`), `@nswds/ui` **`^6` (8 consuming repos, while 7.0.2 is published** — see [FLEET.md](FLEET.md) open issues; nswds-ui's own apps resolve the workspace copy through `*`) |
| [Base UI](https://base-ui.com/) | nswds-ui | The headless primitive layer under `@nswds/ui` |
| [shadcn/ui](https://ui.shadcn.com/) pattern | nswds-ui (own registry at `apps/registry`), nswds-app, awards, nswds-email | `class-variance-authority`, `tailwind-merge`, `clsx`, `lucide-react` |
| [Radix UI](https://www.radix-ui.com/) primitives | awards, nswds-app, nswds-email | Previous generation, arriving through `@nswds/app` |
| [Headless UI](https://headlessui.com/) | awards, nswds-app, nswds-email | |
| [next-themes](https://github.com/pacocoursey/next-themes) | 10 repos | Dark-mode theming |
| [Sass](https://sass-lang.com/) | nswds-tokens | Build pipeline only |

## Application libraries

| Technology | Where |
|---|---|
| [zod](https://zod.dev/) 4 | 7 repos (validation) |
| [react-hook-form](https://react-hook-form.com/) + `@hookform/resolvers` | 6 repos |
| [TanStack Table](https://tanstack.com/table) | 6 repos (via `@nswds/app` DataTable) |
| [Zustand](https://zustand.docs.pmnd.rs/) | 5 repos |
| [Recharts](https://recharts.org/) | attestation, nswds-app, nswds-email |
| [sonner](https://sonner.emilkowal.ski/) | 5 repos |
| [date-fns](https://date-fns.org/) | 4 repos |
| [culori](https://culorijs.org/) | nswds-app, nswds-design, nswds-email, nswds-tokens (colour tooling) |
| [Vercel AI SDK](https://sdk.vercel.ai/) (`ai`, `@ai-sdk/azure`, `@ai-sdk/openai`) | agile |
| [Vue](https://vuejs.org/) 3 | nswds-email-builder, nswds-email-design (Maizzle 6 templating) |

## Auth, data and email

| Technology | Where | Notes |
|---|---|---|
| [Better Auth](https://www.better-auth.com/) | attestation, awards, engagement, nswds-app, nswds-email, reviewers | The only auth library in the fleet; Drizzle adapter |
| [Neon](https://neon.tech/) Postgres (`@neondatabase/serverless`) | attestation, awards, digitalnsw, engagement, nswds-app, nswds-email, reviewers | The only database in the fleet |
| [Drizzle ORM](https://orm.drizzle.team/) + drizzle-kit | attestation, awards, engagement, nswds-app, nswds-email, reviewers | digitalnsw's forms API uses the Neon driver directly |
| [PGlite](https://pglite.dev/) | nswds-email | In-process Postgres for tests |
| [React Email](https://react.email/) | attestation, engagement, nswds-app, nswds-email, reviewers | |
| [Resend](https://resend.com/) | attestation, digitalnsw, engagement, nswds-email, reviewers | |
| [Vercel Blob](https://vercel.com/storage/blob) | attestation, reviewers | |

## Email frameworks

| Technology | Where | Notes |
|---|---|---|
| [Maizzle](https://maizzle.com/) 6 | nswds-email-design (`packages/email`, the `@nswds/email` framework, unpublished), nswds-email-builder | Tailwind 4, Vue single-file components |
| Maizzle 5 | nswds-email-framework, nswds-email-starter | Tailwind 3; not migrating |

## Testing and component development

| Technology | Where | Notes |
|---|---|---|
| [Vitest](https://vitest.dev/) | attestation, engagement, nswds-app, nswds-design, nswds-email-design, nswds-tokens, nswds-ui | Vitest 5 in nswds-design, nswds-tokens and nswds-email-design; Vitest 4 elsewhere. nswds-app and nswds-ui run browser mode through `@storybook/addon-vitest`, which is why vitest and vite majors are blocked there |
| Node's `node:test` | nswds-devops, nswds-eslint-config, nswds-prettier-config, nswds-metadata, awards, nswds-email, nswds-email-framework | Run through `npm test` by the shared test gate. nswds-ui also uses the runner (`test:scripts`) but has no root `test` script, so its suites reach the gate through the workspace-vitest path instead |
| [Storybook](https://storybook.js.org/) 10 | nswds-app, nswds-ui | With `addon-a11y`, `addon-docs`, `addon-themes`, `addon-vitest` |
| [Chromatic](https://www.chromatic.com/) | nswds-ui | Visual regression per PR; passes silently when the monthly snapshot quota is exhausted, so read the run log on CSS or token changes |
| [Playwright](https://playwright.dev/) | nswds-app, nswds-ui (Storybook browser tests), nswds-email-framework, nswds-email-design | Visual regression suites in the two email repos |
| [axe-core](https://github.com/dequelabs/axe-core-npm) | nswds-email-framework (`@axe-core/cli`), nswds-email-design (`@axe-core/playwright`) | Accessibility automation; every property carries WCAG 2.2 AA obligations |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | nswds-email-framework | |
| `publint`, `@arethetypeswrong/cli` | nswds-ui, nswds-metadata, nswds-email-design | Package-surface checks on publishers |
| The shared `install / test` gate | every fleet repo | Runs vitest at the root, else `npm test`, else vitest in workspaces |

## Build and developer tooling

| Technology | Where | Notes |
|---|---|---|
| [ESLint](https://eslint.org/) 10 via `@nswds/eslint-config` | 17 repos depend on the shared package: 16 directly (Next.js entry point or `./base`) and nswds-email-design through its `@workspace/eslint-config`. The two non-adopters are nswds-ui, whose workspace config wraps `eslint-plugin-react` itself, and nswds-tokens, which keeps a bespoke config | Fleet-wide eslint major block in Renovate remains only for nswds-ui's workspace config |
| [Prettier](https://prettier.io/) 3 via `@nswds/prettier-config` | 24 repos | `package.json` key or a `.prettierrc.mjs` that spreads the base |
| [Turborepo](https://turbo.build/) 2 | nswds-ui, nswds-email-design | Workspace monorepos |
| [tsup](https://tsup.egoist.dev/) | nswds-app, nswds-email-design, nswds-tokens, nswds-ui | Package builds |
| [Conventional Commits](https://www.conventionalcommits.org/) via [commitlint](https://commitlint.js.org/) 21 + [husky](https://typicode.github.io/husky/) 9 | every fleet repo | Shared config from this repo; [Commit Messages](docs/best-practices/commit-messages.md) |
| [git-conventional-commits](https://github.com/qoomon/git-conventional-commits) | every fleet repo | The synced YAML, kept in lockstep with `commit-types.mjs` |
| [semantic-release](https://github.com/semantic-release/semantic-release) 25 | all 29 repos | Conventionalcommits preset pinned to `^9`; publishes to npm in six repos over OIDC trusted publishing; [Releases](docs/best-practices/releases.md) |
| AI commit, branch and PR-title tooling | every fleet repo | The shared scripts here (`npm run commit`, `npm run branch:suggest`, the ai-pr-title and openai-pr-description workflows), calling the Vercel AI Gateway with secret redaction |
| Node 24.16.0 (`.nvmrc`), `engine-strict=true` | every fleet repo | `engines.node` `^22.22.2 \|\| >=24.15.0`; npm majors blocked in Renovate until the platform bundles them |

## Fleet automation (this repo)

| Technology | Role |
|---|---|
| [repo-file-sync-action](https://github.com/BetaHuhn/repo-file-sync-action) | Propagates shared scripts, configs and workflow stubs as auto-merging PRs (SHA-pinned; driven by the `nswds-devops-sync` GitHub App) |
| Reusable GitHub Actions workflows | CI logic lives here once, consumed via thin synced stubs pinned to the floating `v1` tag ([GitHub Actions](docs/best-practices/github-actions.md)) |
| Renovate shared preset (`default.json`) | Read from `main` at run time by the Mend app ([Renovate](docs/best-practices/renovate.md)) |
| Canonical Snyk policy (`snyk-policy/`) | Block-synced into every repo's `.snyk` with the repo-owned tail preserved |
| Weekly canaries | v1 drift, ccc v10, ccc pin drift, npm self-override, Snyk policy drift ([MAINTENANCE.md](MAINTENANCE.md)) |
| [mark](https://github.com/kovetskiy/mark) | Publishes mapped markdown to Confluence (read-only mirror; version and checksum pinned) |
| `tools/renovate-fleet-dashboard.mjs` | Renders every repo's Dependency Dashboard into one HTML page |

## Security and dependency management

| Technology | Role |
|---|---|
| [Snyk](https://snyk.io/) | Code, dependency and licence scanning on every PR head; `security` and `code` are merge gates. Automatic fix PRs for Critical/High only; upgrade PRs disabled (Renovate's job) |
| [Renovate](https://docs.renovatebot.com/) (Mend GitHub App) | Weekly grouped non-majors, individual majors, monthly lockfile maintenance; automerge for devDependency patches, lint/format tooling and lockfile maintenance |
| GitHub rulesets | "Protect main" on every fleet repo with the release deploy key as the only bypass actor; org-level "Copilot Review" ruleset on every repo |
| Secret redaction | `scripts/secret-redaction.sh` strips secret-looking content from diffs before they leave the machine for the AI Gateway |

## Hosting and deployment

| Platform | Where |
|---|---|
| [Vercel](https://vercel.com/) (team "Digital NSW", Pro) | 15 repos, 20 projects, listed per repo in FLEET.md. Previews on every PR, production from `main` |
| GitHub Pages | digitalnsw, images, share |
| [Microsoft Power Platform](https://www.microsoft.com/en-au/power-platform) | ictds-portal-flows (bespoke production deploy pipeline; never overwritten by the sync) |
| [Azure](https://azure.microsoft.com/) via [Pulumi](https://www.pulumi.com/) TypeScript (`@pulumi/azure-native`) | dtl-sandbox (manual `pulumi up`); Azure OpenAI in the DTL sandbox also backs the AI Gateway fallback |
| npm registry | `@nswds/ui`, `@nswds/tokens`, `@nswds/app`, `@nswds/eslint-config`, `@nswds/prettier-config`, `@nswds/metadata`, all public, OIDC trusted publishing |
| [Confluence](https://dsia.atlassian.net/wiki) (GDS space) | Read-only documentation mirror for repos with a manifest |

## Analytics and monitoring

| Technology | Where |
|---|---|
| [Vercel Analytics](https://vercel.com/analytics) | awards, nswds-email, nswds-public-sans |
| [PostHog](https://posthog.com/) | nswds-email, nswds-public-sans |
| Runtime error tracking | None. No repo has Sentry or an equivalent; this is the largest gap in the stack |

## Outside the fleet

| Technology | Where |
|---|---|
| SharePoint Framework (SPFx) with heft, React 17, Fluent UI, Node 22 | ai-type-selector, commitments-dashboard |
| R | nswtheme |

## Not in use

Candidates that have been considered and are not adopted anywhere, listed so
they are not re-evaluated from scratch:

- **Sentry** (or equivalent error monitoring): not adopted. If adopted, one
  org, a project per repo, config delivered via the file sync.
- **`@t3-oss/env-nextjs`** (build-time environment validation): not adopted;
  zod is already present in every app repo, so the cost would be small.
- **Sanity** (headless CMS): not adopted.
- **Auth.js / NextAuth**, **Turso / libSQL**, **Prisma**: no repo uses them;
  the fleet has converged on Better Auth, Neon and Drizzle.
- **Dependabot**: replaced by Renovate and Snyk; only the branch-naming
  exemption for `dependabot/…` branches remains.
- **OpenCommit**: replaced by the shared AI commit scripts; its
  `.opencommitignore` file format is reused by those scripts.
- **Cloudflare**: the only code usage is optional Turnstile spam protection
  on the digitalnsw forms backend. Any DNS fronting lives outside the repos.
