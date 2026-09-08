// Structural guards for default.json, the shared Renovate preset.
//
// Every consumer extends this file live from the default branch, so a mistake
// here is a fleet-wide behaviour change the moment it merges — no tag, no
// promotion step, no fan-out PR to review it in. The blocks in particular fail
// SILENTLY when they are wrong: a block that matches nothing produces no PRs,
// and a repo with no PRs looks quiet rather than broken. reviewers, engagement
// and awards each sat in that state for a week (see the npm-self-override
// canary's header for that story).
//
// WHAT THIS FILE CAN AND CANNOT DO, stated up front because pretending
// otherwise is what went wrong three times with snyk-policy/base.snyk:
//
//   CAN  — assert the SHAPE of a rule against the repo's own data: that a
//          block is scoped, that a repo it names exists, that nothing later
//          silently voids it, that it states how it ends.
//   CANNOT — assert that a rule's factual claims are still TRUE. Peer ranges,
//          npm `latest` versions and which repos depend on what all live in
//          the registry and in sibling repos, and they drift without anything
//          in this repo changing. That is canary work, not unit-test work —
//          see ccc-v10-canary.yml for the shape (probe upstream weekly, open
//          one tracking issue, never a recurring red job).
//
// So: a green run here means the preset is well-formed. It does not mean the
// prose in it is true.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseFleetFromSyncConfig } from './renovate-fleet-dashboard.mjs'

const preset = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'))
const rules = preset.packageRules ?? []

/** Rules that switch updates OFF. These are the ones that fail invisibly. */
const blocks = rules
  .map((rule, index) => ({ rule, index }))
  .filter(({ rule }) => rule.enabled === false)

/** A block scoped to named packages, as opposed to one scoped to a depType. */
const packageBlocks = blocks.filter(({ rule }) => Array.isArray(rule.matchPackageNames))

const label = ({ rule, index }) =>
  `packageRules[${index}] (${(rule.matchPackageNames ?? rule.matchDepTypes ?? []).join(', ')})`

test('the preset actually contains blocks to check', () => {
  // Guards the guards: every assertion below iterates a filtered list, and an
  // empty list passes all of them. If a refactor renames `enabled` or moves the
  // blocks elsewhere, these tests would go green having checked nothing —
  // the same "sail through as clean" failure the jq and git-grep gates in
  // reusable-ci.yml are written to avoid.
  assert.ok(rules.length > 0, 'default.json declares no packageRules at all')
  assert.ok(packageBlocks.length >= 5, `expected the known package blocks; found ${packageBlocks.length}`)
})

test('the packages the fleet has decided to block are still blocked', () => {
  // Pins the DECISIONS, not the rule count. Deleting `enabled: false` from a
  // rule leaves it in the file, reading exactly like a block, while every
  // update flows through — and a count-based check does not notice, because
  // the rule is still there. Mutation-verified: removing the flag from the
  // vitest rule passed every other assertion in this file.
  //
  // Asymmetric on purpose. Adding a NEW block does not fail here, so this
  // never taxes a genuine addition. Removing one does, which is the point:
  // lifting a fleet-wide block should require deleting a line from this list,
  // deliberately, in a diff someone reviews — not just dropping a JSON key.
  //
  // When a block's removal condition is genuinely met, delete its entry here
  // in the same commit that lifts it.
  const MUST_STAY_BLOCKED = [
    'npm',
    'conventional-changelog-conventionalcommits',
    'typescript',
    'eslint',
    '@maizzle/framework',
    'tailwindcss',
    'vite',
    'vitest',
    '@vitest/**',
  ]

  const blocked = new Set(packageBlocks.flatMap(({ rule }) => rule.matchPackageNames))
  const missing = MUST_STAY_BLOCKED.filter((name) => !blocked.has(name))

  assert.deepEqual(
    missing,
    [],
    `these packages are no longer blocked: ${missing.join(', ')}. ` +
      'If that is deliberate, remove them from MUST_STAY_BLOCKED in the same commit.',
  )
})

test('a block scoped to named packages also declares which update types it blocks', () => {
  // `enabled: false` with no matchUpdateTypes blocks EVERY update to those
  // packages — patches and security fixes included, not just the major someone
  // meant to stop. Nothing goes red; the packages simply stop moving, which is
  // indistinguishable from upstream being quiet.
  //
  // depType-scoped blocks are deliberately exempt: the `overrides` rule blocks
  // all update types on purpose, because the shared policy is that overrides
  // are pinned by hand. Scoping it by update type would defeat it.
  for (const entry of packageBlocks) {
    assert.ok(
      Array.isArray(entry.rule.matchUpdateTypes) && entry.rule.matchUpdateTypes.length > 0,
      `${label(entry)} disables updates for named packages without declaring matchUpdateTypes, ` +
        'so it blocks patches and security fixes too. Add matchUpdateTypes (usually ["major"]).',
    )
  }
})

test('no later rule re-enables what an earlier rule blocked', () => {
  // Renovate applies packageRules in array order and LATER MATCHES WIN — the
  // nswds-ui semantic-commit rule's own description calls this out as
  // load-bearing. A rule further down that sets `enabled: true` can therefore
  // void a block above it, and the block stays in the file reading as though
  // it still applies.
  //
  // Asserted as a flat prohibition rather than by modelling matcher overlap,
  // because the overlap analysis is exactly the subtle part a reviewer would
  // get wrong. The preset re-enables nothing today. If a rule ever genuinely
  // needs to, that is a deliberate decision: restructure so the narrower rule
  // is the only one matching, or change this test and say why in the diff.
  const reEnabling = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled === true)

  assert.deepEqual(
    reEnabling.map(({ index }) => index),
    [],
    'a packageRule sets enabled: true. Later matches win, so it may silently void a block above it.',
  )
})

test('a repo-scoped rule names repos that exist in the fleet', () => {
  // A typo in matchRepositories does not error — the rule simply matches no
  // repository, and a block that matches nothing blocks nothing. The majors it
  // was written to stop flow through, and the rule sitting in the file is the
  // reason nobody looks.
  //
  // Checked against .github/sync.yml, the same source the fleet dashboard uses.
  // That set is the file-sync fleet and excludes nswds-devops itself, which is
  // allowed here because the preset can legitimately scope a rule to its own
  // repo. A consumer outside the digitalnsw org (bastianbuilt extends this
  // preset from laurenhitchon/) would not appear either, so only digitalnsw
  // entries are checked for membership; everything is checked for shape.
  const fleet = parseFleetFromSyncConfig(
    readFileSync(new URL('../.github/sync.yml', import.meta.url), 'utf8'),
  )

  for (const entry of rules.map((rule, index) => ({ rule, index }))) {
    const repos = entry.rule.matchRepositories
    if (!Array.isArray(repos)) continue

    for (const repo of repos) {
      assert.match(
        repo,
        /^[\w.-]+\/[\w.-]+$/,
        `${label(entry)} matchRepositories entry "${repo}" is not owner/repo shaped, so it matches nothing.`,
      )
      if (!repo.startsWith('digitalnsw/')) continue
      assert.ok(
        fleet.has(repo) || repo === 'digitalnsw/nswds-devops',
        `${label(entry)} scopes to "${repo}", which is not in .github/sync.yml. ` +
          'Either it is a typo (the rule then matches nothing and blocks nothing), ' +
          'or the repo needs adding to the sync fleet.',
      )
    }
  }
})

// NOT TESTED, deliberately: that a rule's description names the repos it
// matches. It was written, and mutation testing killed it. Adding
// digitalnsw/nswds-tokens to the vitest block's matchRepositories left a
// substring check green, because that description legitimately names
// nswds-tokens ~1,200 characters in, in the list of repos the rule explicitly
// does NOT cover. Anchoring to a position does not rescue it either: the
// maizzle and vitest rules name their scope in a trailing parenthetical, while
// the two semantic-commit rules name theirs before the parenthesis and use the
// parenthesis for something else.
//
// So there is no reliable place to look, and a check that passes the mutation
// it exists to catch is worse than none — it reads as a guarantee. Prose and
// matcher drifting apart is a human review job here. Left documented rather
// than silently uncovered.

test('every package block declares how it ends', () => {
  // A block with no stated exit is how a fleet accumulates permanent freezes
  // that nobody remembers the reason for. Each of these must say either what
  // would lift it, or that it is deliberately permanent.
  //
  // BE CLEAR ABOUT WHAT THIS PROVES: only that the sentence is present. It
  // cannot tell whether the condition is still unmet, whether the upstream
  // issue it cites is still open, or whether "permanent" is still the right
  // call. Those need a human, or a canary that probes upstream. Treating a
  // green run here as evidence the blocks are still justified is the mistake.
  const DECLARES_AN_EXIT = /remove (this rule|when|it)|lift (this|the) block|treat this block as permanent/i

  for (const entry of packageBlocks) {
    assert.match(
      entry.rule.description ?? '',
      DECLARES_AN_EXIT,
      `${label(entry)} blocks updates without saying what would lift the block. ` +
        'State the removal condition, or say explicitly that it is permanent and why.',
    )
  }
})
