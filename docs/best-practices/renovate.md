# Renovate

The operating manual for Renovate across the digitalnsw fleet: what it
does, why we run it, how the config propagates, and how to work with (and
around) it day to day. For where Renovate sits in the wider three-layer
picture (Renovate + Snyk + install gate), see
[Dependency Management](dependency-management.md).

## What Renovate is and what it does here

[Renovate](https://docs.renovatebot.com/) is a dependency-update bot,
installed as the **Mend Renovate GitHub App** on every repo in the org. It
scans each repo's `package.json` + `package-lock.json` (and, in this repo
only, GitHub Actions workflow pins), compares against the npm registry, and
opens pull requests that bump dependencies — with release notes, adoption
data, and a rendered diff of what changed.

Concretely, every repo gets:

- **One grouped PR per week** (Monday before 7am Sydney) containing all
  pending **non-major** updates — patch and minor bumps travel together so
  the review load is one PR, not twenty.
- **Individual PRs for majors** — each major arrives alone, whenever it's
  released, because majors need individual judgement.
- **A monthly "Lock file maintenance" PR** (first day of the month) that
  regenerates `package-lock.json` from scratch with real npm, keeping
  transitive pins fresh even when no direct dependency moved.
- **A Dependency Dashboard issue** — an always-open issue in each repo
  listing every pending, rate-limited, blocked, and errored update. This is
  the control panel; see [Using the Dependency Dashboard](#using-the-dependency-dashboard).

Renovate PRs are labelled `dependencies`, commit as `chore(deps): …`
(so merging one never forces a release — see
[Releases](releases.md)), and their `renovate/…` branches are exempt from
the branch-naming policy in `scripts/branch-name-config.sh`.

## Why we use it

- **Drift is the default.** Before automation, repos sat years behind on
  routine bumps and every upgrade became a project. Weekly grouped PRs keep
  the delta small enough that merging is boring.
- **Small diffs are reviewable diffs.** A week of patch bumps is a
  five-minute review; eighteen months of them is an archaeology dig.
- **Security posture.** Staying current is most of vulnerability
  management. (Actual CVE alerting and fix PRs are deliberately **Snyk's
  job**, not Renovate's — `vulnerabilityAlerts` is disabled in the preset so
  the two bots never open duplicate PRs for the same CVE.)
- **Central policy, fleet-wide effect.** One preset file in this repo
  governs all 17+ repos. A policy change lands everywhere on Renovate's
  next run with no per-repo work at all.

## Where the config lives (and how it propagates)

Three files, two of them here:

| File | Role |
| --- | --- |
| [`default.json`](../../default.json) (this repo) | **The org preset. The only file you edit to change policy.** Renovate resolves `github>digitalnsw/nswds-devops` to this file *from `main` at run time*, so a merged change applies fleet-wide on the next Renovate run — no sync, no tag move. |
| [`repo-files/renovate.json`](../../repo-files/renovate.json) (synced out) | What consumer repos hold: a two-line `extends` pointer at the preset, npm manager only. Delivered by the file-sync like everything else; it only ever needs re-syncing if the pointer itself changes. Marked DO NOT EDIT — a consumer-side edit is silently overwritten by the next sync PR. |
| [`renovate.json`](../../renovate.json) (this repo's own) | This repo dogfoods the same preset but additionally enables the `github-actions` manager, so Renovate also maintains the action pins in `reusable-*.yml`. (SHA-pinned third-party actions stay pinned — Renovate updates the SHA and keeps the version comment.) |

The preset itself extends Renovate's
[`config:recommended`](https://docs.renovatebot.com/presets-config/#configrecommended),
[`:semanticCommits`](https://docs.renovatebot.com/presets-default/#semanticcommits),
and
[`group:allNonMajor`](https://docs.renovatebot.com/presets-group/#groupallnonmajor),
then sets: `timezone` Australia/Sydney, weekly schedule, `prConcurrentLimit`
5 (so a repo is never flooded), the `dependencies` label, and
`gitIgnoredAuthors` for the github-actions bot (so release commits don't
make Renovate think a human edited its branch and stop rebasing).

## Dashboards and links

- **Per-repo Dependency Dashboard** — the "Dependency Dashboard" issue in
  each repo's Issues tab (e.g.
  [nswds-email's](https://github.com/digitalnsw/nswds-email/issues?q=is%3Aissue+is%3Aopen+%22Dependency+Dashboard%22)).
  Day-to-day control panel; start here.
- **Mend Developer Portal** — <https://developer.mend.io/> (sign in with
  GitHub → the `digitalnsw` org): per-repo job logs, run history, and an
  on-demand "run now" trigger. This is where to look when Renovate seems to
  be doing nothing.
- **Renovate docs** — <https://docs.renovatebot.com/>; most useful pages:
  [configuration options](https://docs.renovatebot.com/configuration-options/),
  [shareable presets](https://docs.renovatebot.com/config-presets/),
  [`packageRules`](https://docs.renovatebot.com/configuration-options/#packagerules).
- **GitHub App** — <https://github.com/apps/renovate> (org installation
  managed at the org settings level).

## Using the Dependency Dashboard

The dashboard issue lists every update Renovate knows about, grouped by
state. The checkboxes are live controls — ticking one tells Renovate to act
on its next run:

- **Force a PR outside the schedule**: tick the box next to a
  pending/scheduled update.
- **Retry an errored or closed update**: tick its box under
  "Errored"/"Closed" — this is also how you resurrect a PR you closed.
- **Rebase everything**: tick "Check this box to trigger a request for
  Renovate to run again on this repository".
- **See what's deliberately blocked**: the preset's disabled rules (below)
  surface here rather than as PRs — the dashboard is the only place you'll
  see them.

On an individual PR, ticking the "rebase/retry" checkbox in the PR body
makes Renovate recreate the branch from scratch — the correct fix for
almost any broken Renovate branch, and always preferable to pushing manual
commits onto it.

## Reviewing and merging Renovate PRs

Renovate PRs go through the same gates as human PRs — `commitlint /
commitlint` and `install / install` are required, and the install gate
(`npm clean-install` on the test merge) is the backstop that proves the
lockfile is coherent. House rules:

- **Green grouped weekly PR**: skim the release notes, merge. That's the
  system working.
- **Major PRs**: read the linked changelog/migration guide; if now isn't
  the time, leave it open (it stays rebased) or close it — it remains
  retryable from the dashboard. Park deliberately, and work the backlog at
  least quarterly ([Dependency Management](dependency-management.md)).
- **Red `install / install` on a bot PR**: close and let the bot recreate
  it (dashboard checkbox). **Never resolve a lockfile conflict in the web
  editor** — only npm may write `package-lock.json`
  ([Dependency Management](dependency-management.md) has the full lockfile
  rules).
- **Don't push commits to `renovate/…` branches.** A human commit stops
  Renovate from rebasing that branch (it assumes you've taken over). If a
  bump needs accompanying code changes, that's a signal to do the upgrade
  as a normal human PR and close Renovate's.
- Merging a `chore(deps)` PR doesn't cut a release. If consumers need the
  bump shipped, follow with a deliberate release
  ([Releases](releases.md)).

## Blocked updates (packageRules) — and why

The preset carries `packageRules` that disable specific updates
org-wide. Every rule embeds its own `description` with the incident that
motivated it and the condition for removing it — [`default.json`](../../default.json)
is the source of truth; this table is the summary:

| Blocked | Why | Remove when |
| --- | --- | --- |
| `npm` engine majors | `engine-strict=true` + an `engines.npm` ahead of the platform-bundled npm fails every install with `EBADENGINE` (nswds-email#460) | the platform bundles the new npm major — coordinated adoption pass |
| Lockfile-only bumps of `overrides`-pinned packages | Renovate applies them as a direct-dep install that conflicts with the override → `EOVERRIDE` → the whole grouped PR ships a stale lockfile (nswds-email#459) | n/a — monthly lock file maintenance keeps these pins fresh instead |
| `conventional-changelog-conventionalcommits` v10 | incompatible with release-notes-generator 14: releases succeed but changelogs silently come out empty (nswds-email#437; upstream #992) | a v10.x compatible with release-notes-generator 14 ships |
| `typescript` majors (6/7) | TS7 is the native compiler with no JS API: `next build` fails, typescript-eslint crashes, import-sorting silently no-ops (nswds-email#444) | Next.js + typescript-eslint declare TS 6/7 support |
| `eslint` majors (10) | ESLint 10 removed `context.getFilename()`, still called by eslint-plugin-react — every lint invocation crashes, and PR CI wouldn't catch it (nswds-app#418; vercel/next.js#89764) | eslint-config-next ships an ESLint-10-compatible plugin set |

**Adding a block** (the pattern): when an update breaks the fleet, add a
`packageRules` entry to `default.json` with `matchPackageNames` /
`matchDepTypes` / `matchUpdateTypes` scoped as tightly as possible,
`"enabled": false`, and a `description` that records the symptom, the
incident/issue reference, and the removal condition. Merge to `main`; it
applies everywhere on the next run. These rules are parked debt — reread
them whenever their removal condition might have been met.

## Changing policy

1. Edit [`default.json`](../../default.json) on a branch here, PR into
   `main`. (Validate locally first:
   `npx --package renovate renovate-config-validator default.json`.)
2. Merge. **Done** — Renovate reads the preset from `main` at run time, so
   there's no sync PR, no tag move, and no per-repo step. Expect it to take
   effect on each repo's next Renovate run (or force one from the
   dashboard / Mend portal).
3. Update this guide (and [Dependency Management](dependency-management.md)
   if the strategy changed) in the same PR — the
   [change process](README.md) requires docs and tooling to move together.

Only if the `extends` pointer or enabled managers change does
`repo-files/renovate.json` need touching — that change fans out as normal
sync PRs.

## Onboarding a repo

Nothing Renovate-specific to do: the Mend app is installed org-wide, and
the synced `renovate.json` arrives with the repo's first sync PR
([ONBOARDING.md](../../ONBOARDING.md)). On its first run Renovate opens the
Dependency Dashboard issue and starts proposing updates on the next
scheduled window.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Lock file maintenance" PR red on `install / install` with `npm ci … not in sync` | from-scratch regeneration can hit npm's peer-nesting bug (conventional-commits-filter 5 vs 6 — full write-up in nswds-email#454). Close the PR; retry from the dashboard once the stacks re-align |
| Renovate opened nothing this week | check the [Mend portal](https://developer.mend.io/) job log — commonly there was simply nothing pending, or `prConcurrentLimit` (5) is saturated by open Renovate PRs; merge or close some |
| An expected update never appears as a PR | check the Dependency Dashboard "blocked"/rate-limited sections and the [blocked-updates table](#blocked-updates-packagerules--and-why) — it may be deliberately disabled |
| Renovate stopped rebasing a PR | a human (or non-ignored bot) commit landed on the branch — tick the rebase checkbox to have it recreated, or take the upgrade over as a human PR |
| Snyk check red on a Renovate lockfile change | usually Snyk re-baselining, not the bump — see [Dependency Management](dependency-management.md) |
| Config change seems ignored | preset edits must be **merged to `main`** here (Renovate doesn't read branches); validate with `renovate-config-validator`, then check the repo's job log in the Mend portal for config-parse errors |
