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

- **One grouped PR per week** (Monday before 7am Sydney) containing the
  pending **non-major** updates that need a human: production patches,
  production minors and devDependency minors travel together so the review
  load is one PR, not twenty.
- **A self-merging "dev dependencies (patch)" PR**, also weekly — devDependency
  patch bumps are split into their own group and **automerged** once the
  checks pass. Usually you'll never see it; it shows up in the commit log,
  not your review queue ([Automerge](#automerge)).
- **Individual PRs for majors** — each major arrives alone, whenever it's
  released, because majors need individual judgement.
- **A monthly "Lock file maintenance" PR** (first day of the month) that
  regenerates `package-lock.json` from scratch with real npm, keeping
  transitive pins fresh even when no direct dependency moved. Also
  automerged, when green.
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
  governs all 24 consumer repos. A policy change lands everywhere on Renovate's
  next run with no per-repo work at all.

## Where the config lives (and how it propagates)

Three files, two of them here:

| File | Role |
| --- | --- |
| [`default.json`](../../default.json) (this repo) | **The org preset. The only file you edit to change policy.** Renovate resolves `github>digitalnsw/nswds-devops` to this file *from `main` at run time*, so a merged change applies fleet-wide on the next Renovate run — no sync, no tag move. |
| [`repo-files/renovate.json`](../../repo-files/renovate.json) (synced out) | What consumer repos hold: a two-line `extends` pointer at the preset, with the `npm` and `github-actions` managers enabled — Renovate maintains both package deps and the action versions in each repo's workflow stubs. Delivered by the file-sync like everything else; it only ever needs re-syncing if the pointer or manager list changes. Marked DO NOT EDIT — a consumer-side edit is silently overwritten by the next sync PR. |
| [`renovate.json`](../../renovate.json) (this repo's own) | This repo dogfoods the same preset with the same two managers, so Renovate also maintains the action pins in `reusable-*.yml`. (SHA-pinned third-party actions stay pinned — Renovate updates the SHA and keeps the version comment.) |

The preset itself extends Renovate's
[`config:recommended`](https://docs.renovatebot.com/presets-config/#configrecommended),
[`:semanticCommits`](https://docs.renovatebot.com/presets-default/#semanticcommits),
and
[`group:allNonMajor`](https://docs.renovatebot.com/presets-group/#groupallnonmajor),
then sets: `timezone` Australia/Sydney, weekly schedule, `prConcurrentLimit`
5 (so a repo is never flooded), `rebaseWhen` `conflicted`
([Rebasing and staying up to date](#rebasing-and-staying-up-to-date)), the
`dependencies` label, and `gitIgnoredAuthors` for the github-actions bot (so
release commits don't make Renovate think a human edited its branch and stop
rebasing). Two categories are automerged — devDependency patches and lock
file maintenance ([Automerge](#automerge)).

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

## Rebasing and staying up to date

The preset sets **`rebaseWhen: "conflicted"`**. Renovate recreates one of its
branches only when that branch genuinely conflicts with `main` — normally a
lockfile collision it has to resolve itself. It does **not** rebase a branch
merely because `main` has moved on.

This is a deliberate override of Renovate's `"auto"` default, and the reason
is our own branch protection. Every consumer repo's "Protect main" ruleset
sets `strict_required_status_checks_policy: true` ("require branches to be up
to date before merging"), and Renovate treats `"auto"` on such a repo as
`"behind-base-branch"`. That combination means **every merge to `main`
rebases every open Renovate PR in the repo**, and every rebase re-runs the
full check suite — `install`, `lint`, `typecheck`, `format`, `test`,
`commitlint`, `ai-pr-title`. At `prConcurrentLimit` 5 that is up to five
complete re-runs per repo per merge, none of which gate the merge that caused
them. Actions minutes then scale with *merges × open PRs* rather than with
merges, and GitHub rounds every job up to the nearest minute when billing.

What this changes day to day:

- **A Renovate PR that has fallen behind `main` will not update itself.** It
  sits there, green but stale, and the merge box says the branch is out of
  date. Press **Update branch** (or `gh pr update-branch <n>`) when you're
  ready to merge it — that spends one check run, on the one PR you're
  actually merging.
- **Merge the weekly grouped PR first** when several are open. It's the
  largest and the most likely to conflict with the rest; the others will be
  rebased automatically if it collides with them.
- **A genuinely conflicted branch still self-heals.** That's what
  `conflicted` covers, so the old advice holds: don't hand-resolve a
  `package-lock.json` conflict, let Renovate redo the branch.

Revisit this setting if strict required status checks are ever relaxed — with
`strict` off, `"auto"` stops meaning `behind-base-branch` and the amplifier
disappears.

## Automerge

Two categories merge themselves once every required check is green. Nothing
else does.

| Automerged | Group | Why it's safe |
| --- | --- | --- |
| **devDependency patches** | `dev dependencies (patch)` | Patch is bug-fix-by-convention; devDependencies can't reach production; and `install / lint / typecheck / format / test` all have to pass first |
| **Lock file maintenance** | `Lock file maintenance` | Touches `package-lock.json` only — no manifest, no source. `install / install` is precisely the gate that proves a regenerated lockfile is coherent |

Both are held to a **`minimumReleaseAge` of 3 days** on the dev-patch side:
automerge means nobody reads these, so an update that gets yanked or
hot-patched within hours of publishing never becomes a merge in the first
place.

### Why devDependencies only

`config:recommended` pulls in
[`:semanticPrefixFixDepsChoreOthers`](https://docs.renovatebot.com/presets-default/#semanticprefixfixdepschoreothers),
so Renovate commits **production** dependency updates as `fix(deps)` and
**dev** dependencies as `chore(deps)`. The shared `release.config.mjs` runs
the `conventionalcommits` preset, where `fix` cuts a **patch release** — and
five repos publish on release (`nswds-ui`, `nswds-tokens`, `nswds-app`,
`nswds-eslint-config`, `nswds-prettier-config`).

So automerging a production patch would publish to npm with nobody in the
loop. `chore(deps)` releases nothing, which is why the line is drawn at
devDependencies rather than at "all patches". Production patches keep
arriving in the weekly grouped PR for a human to merge.

### What this does and doesn't change

- **It doesn't weaken any gate.** Automerge waits for the same required
  checks as a human merge, and it can never merge a red PR. A dev-patch PR
  that fails `test` just sits there, exactly as it would today.
- **It doesn't touch majors or minors.** Those are unchanged — grouped
  weekly for non-majors, individually for majors.
- **It does close the stale-PR loop.** Combined with `rebaseWhen:
  conflicted` above, the highest-volume, lowest-risk category no longer sits
  open collecting "Update branch" re-runs; it opens, runs its checks once,
  and merges.
- **These PRs are exempt from the fleet rebase policy.** Both carry
  `rebaseWhen: behind-base-branch`, because an automerge PR that falls behind
  `main` can't merge under strict checks and would otherwise never be
  refreshed — it would sit unmergeable forever. They're short-lived by
  construction, so the re-runs that buys are bounded and each one ends in a
  merge.

### Prerequisite: `allow_auto_merge`

Renovate prefers GitHub's **native** auto-merge (`platformAutomerge`, on by
default), which merges the instant the last required check turns green. That
needs "Allow auto-merge" on the repo, which is **enabled fleet-wide** (all 26
repos, 2026-08-04) and is part of [step 1 of onboarding](../../ONBOARDING.md)
for new ones:

```sh
gh api repos/digitalnsw/<repo> --jq '.allow_auto_merge'     # check
gh api -X PATCH repos/digitalnsw/<repo> -F allow_auto_merge=true
```

If it were off nothing would break — Renovate falls back to merging the PR
itself on its next run, a delay of up to about an hour rather than seconds.
Either way the weekly `schedule` does **not** hold automerges back to Monday:
`automergeSchedule` defaults to "at any time".

### Turning it off

Per repo, set the `renovate.json` override locally, or park the whole thing
by removing `automerge` from the dev-patch rule and the `lockFileMaintenance`
block in [`default.json`](../../default.json). As with any preset change it
applies fleet-wide on the next run.

## Reviewing and merging Renovate PRs

Renovate PRs go through the same gates as human PRs — `commitlint /
commitlint` and `install / install` are required, and the install gate
(`npm clean-install` on the test merge) is the backstop that proves the
lockfile is coherent. House rules:

- **`dev dependencies (patch)` and `Lock file maintenance`**: nothing to do —
  they merge themselves when green ([Automerge](#automerge)). If one is
  sitting open, it's red, and the fix is the same as any other red bot PR
  (below).
- **Green grouped weekly PR**: skim the release notes, merge. That's the
  system working. If the branch is behind `main`, press **Update branch**
  first and merge once the checks come back
  ([Rebasing and staying up to date](#rebasing-and-staying-up-to-date)).
- **Major PRs**: read the linked changelog/migration guide; if now isn't
  the time, leave it open or close it — it remains retryable from the
  dashboard. A parked PR is **not** kept up to date with `main` (that's the
  point of `rebaseWhen: conflicted`); it'll need an **Update branch** and a
  fresh check run whenever you come back to it. Park deliberately, and work
  the backlog at least quarterly
  ([Dependency Management](dependency-management.md)).
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
| All updates to `overrides`-pinned packages | Two ways to the same broken lockfile: in-range bumps go in as a direct-dep install that conflicts with the override → `EOVERRIDE` → stale lockfile (nswds-email#459); range bumps half-apply it — outgoing entry removed, resolved one never added → `npm ci` fails `EUSAGE Missing: …`, with no artifact-update warning on the PR to give it away (nswds-email#485) | Renovate's npm manager writes correct lockfiles for `overrides`. Until then monthly lock file maintenance keeps the resolved versions fresh, and Snyk drives the range bumps by hand |
| `conventional-changelog-conventionalcommits` v10 | incompatible with release-notes-generator 14: releases succeed but changelogs silently come out empty (nswds-email#437; upstream #992) | a v10.x compatible with release-notes-generator 14 ships |
| `typescript` majors (6/7) | TS7 is the native compiler with no JS API: `next build` fails, typescript-eslint crashes, import-sorting silently no-ops (nswds-email#444) | Next.js + typescript-eslint declare TS 6/7 support |
| `eslint` majors (10) | ESLint 10 removed `context.getFilename()`, still called by eslint-plugin-react — every lint invocation crashes, and PR CI wouldn't catch it (nswds-app#418; vercel/next.js#89764). The `fixupConfigRules` shim now ships inside `@nswds/eslint-config`, and the 14 Next.js repos are on eslint ^10 through it — the block stays for **nswds-ui**, whose workspace config imports eslint-plugin-react with no shim | nswds-ui's workspace config wraps or adopts `@nswds/eslint-config/base` (re-check 2026-10) |

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
| Renovate PR is green but "branch is out of date" blocks the merge | expected — `rebaseWhen: conflicted` deliberately leaves behind-but-clean branches alone ([Rebasing and staying up to date](#rebasing-and-staying-up-to-date)). Press **Update branch** / `gh pr update-branch <n>` and merge when the run finishes |
| A `dev dependencies (patch)` or `Lock file maintenance` PR isn't automerging | it's not green. Check every **required** context, including the two Snyk ones — Snyk occasionally never posts on a force-updated or reopened bot branch, and automerge waits forever on a status that never arrives ([Dependency Management](dependency-management.md)). Close and let the bot recreate the PR |
| A devDependency patch didn't appear this week | `minimumReleaseAge` holds automerged updates until the release is 3 days old ([Automerge](#automerge)) — a package published over the weekend waits for the following Monday |
| Renovate stopped rebasing a PR | a human (or non-ignored bot) commit landed on the branch — tick the rebase checkbox to have it recreated, or take the upgrade over as a human PR. Note that a branch that is merely *behind* `main` is not a fault: see the row above |
| Snyk check red on a Renovate lockfile change | usually Snyk re-baselining, not the bump — see [Dependency Management](dependency-management.md) |
| Config change seems ignored | preset edits must be **merged to `main`** here (Renovate doesn't read branches); validate with `renovate-config-validator`, then check the repo's job log in the Mend portal for config-parse errors |
