// Structural guards for the fleet size and membership stated in the docs.
//
// The fleet is defined by two machine-readable files: .github/sync.yml (the
// consumers) and snyk-policy/repos.json (the consumers plus this repo). The docs
// state the same facts in prose, and prose copies rot the moment a repo is added
// — silently, because nothing reads them. Before FLEET.md existed the count was
// written as 21, 24, 25 and 26 in four different files at once.
//
// The fix is mostly not to have copies. The fleet size is stated once, in the
// at-a-glance table in FLEET.md, and everywhere else the docs say "every
// consumer repo". So this file does three things:
//
//   1. Reads the canonical copies structurally — the two fleet-size rows of the
//      at-a-glance table and the member tables — and holds them to the source
//      files exactly. These are covered however they are worded.
//   2. Scans every tracked markdown file for a prose restatement of the fleet
//      size that has crept back in, and fails if one disagrees. In steady state
//      it finds nothing, which is correct.
//   3. Tests the scanner itself against fixed sentences, so a scanner that has
//      quietly stopped matching fails here rather than passing on empty docs.
//
// WHAT THIS FILE CANNOT DO:
//
//   — Assert that anything the docs SAY about a repo is true: its purpose, its
//     live URL, its Vercel projects, its required checks, the version of a
//     package it consumes. All of that lives in GitHub, npm and Vercel and
//     drifts without a commit here. Checking it is canary work against the live
//     APIs, not unit-test work.
//   — See every possible restatement. The scanner recognises a count by a
//     whole-fleet cue: "all N consumer repos", "the N consumers in/plus …",
//     "N repos including this one", "fans out to N". A bare "N consumer repos"
//     is read as a subset ("4 consumer repos lack the Snyk gates") and left
//     alone, and a count written in words is invisible. If you must restate the
//     fleet size, use one of the cued forms — or better, link to FLEET.md.
//
// So a green run means the docs count the same fleet the tooling does, and name
// the same members. It does not mean the rest of FLEET.md is accurate.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

import {
  parseFleetFromSyncConfig,
  parseSyncGroupsFromSyncConfig,
} from './renovate-fleet-dashboard.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')

/** Consumers the file sync distributes to. This repo is deliberately absent — it
 *  is the source, and never appears in its own distribution list. */
const consumers = [...parseFleetFromSyncConfig(read('.github/sync.yml'))]
const consumerNames = consumers.map((slug) => slug.replace(/^digitalnsw\//, ''))

/** Consumers of the canonical Snyk policy block. This repo IS one of these: the
 *  fan-out treats it like any other repo. */
const snykConsumers = Object.keys(JSON.parse(read('snyk-policy/repos.json')).repos)

/** The whole fleet: every consumer plus this repo. */
const wholeFleet = consumers.length + 1

/** Every tracked markdown file, discovered rather than listed, so a doc added
 *  later is scanned without anyone remembering to add it here — the previous
 *  hand-kept list had to be extended by hand for FLEET.md itself. CHANGELOG.md is
 *  generated history, where a past count is correct for its own day. The sync
 *  map's header comment is added because it states the fleet too. */
const docs = [
  ...execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && path.basename(file) !== 'CHANGELOG.md'),
  '.github/sync.yml',
]

/** A gap between two words of a phrase: spaces, or a single line break with its
 *  indentation (and a blockquote marker). This repo hard-wraps markdown, so an
 *  ordinary reflow can put "28" at the end of one line and "consumer repos" at
 *  the start of the next; a per-line scan went blind to that. A blank line is a
 *  paragraph break and deliberately does not count as a gap. */
const GAP = String.raw`(?:[ \t]+|[ \t]*\n[ \t]*(?:>[ \t]*)?)`

/** Builds a scanner from a source where each literal space means "a gap". */
const phrase = (source) => new RegExp(source.replaceAll(' ', GAP), 'g')

/** "repos" and "repositories" are the same word here; README uses both. */
const REPO = String.raw`repo(?:s\b|sitor)`

/** Whole-fleet phrasings only. Each alternative needs a cue that it means the
 *  whole set; see the header for why a bare "N consumer repos" is not one. */
const MATCHERS = {
  consumer: phrase(
    [
      String.raw`\ball (\d+) consumer(?:s\b| ${REPO})`,
      String.raw`\bthe (\d+) consumers? (?:in|plus)\b`,
      String.raw`\b(\d+) consumers? plus (?:this|nswds-devops)\b`,
    ].join('|'),
  ),
  fanOut: phrase(
    [
      String.raw`\bfans out to (\d+) (?:consumer )?${REPO}`,
      String.raw`\bfans out as up to (\d+) PRs\b`,
    ].join('|'),
  ),
  wholeFleet: phrase(
    [String.raw`\b(\d+) ${REPO} including this one\b`, String.raw`\ball (\d+) (?:fleet )?${REPO}`].join(
      '|',
    ),
  ),
}

/** The numbers a matcher reads out of `text`, in order. */
function numbersIn(matcher, text) {
  return [...text.matchAll(matcher)].map((match) =>
    // Every matcher is an alternation, so only one group captured.
    Number(match.slice(1).find((group) => group !== undefined)),
  )
}

/** Every restatement a matcher finds across the docs, with where it is and the
 *  sentence it came from, so a failure shows what to edit. */
function claims(matcher) {
  const found = []
  for (const doc of docs) {
    const text = read(doc)
    for (const match of text.matchAll(matcher)) {
      found.push({
        doc,
        line: text.slice(0, match.index).split('\n').length,
        stated: Number(match.slice(1).find((group) => group !== undefined)),
        phrase: match[0].replace(/\s+/g, ' '),
      })
    }
  }
  return found
}

function assertAgree(found, expected, what) {
  assert.deepEqual(
    found
      .filter((claim) => claim.stated !== expected)
      .map((claim) => `${claim.doc}:${claim.line} says ${claim.stated} ("${claim.phrase}")`),
    [],
    `${what} is ${expected}; these disagree. Prefer "every consumer repo" and a link ` +
      'to FLEET.md over restating the number. If the sentence is about a subset, ' +
      'reword it so it does not read as the whole fleet.',
  )
}

test('the scanner reads whole-fleet counts, reflowed or not, and ignores subsets', () => {
  // This stands in for the old "found at least one claim" guard, which cannot
  // work now the docs deliberately contain no restatements. It proves the
  // scanner still matches, independent of what the docs currently say.
  const reads = [
    ['consumer', 'changes CI for all 28 consumer repos at once', 28],
    ['consumer', 'propagate to all 28\n  consumer repositories', 28],
    ['consumer', '(the 28 consumers in sync.yml plus this repo)', 28],
    ['consumer', '| 29 (28 consumers plus this repo) |', 28],
    ['fanOut', 'one merge fans out to 28 repos', 28],
    ['fanOut', 'a change fans out as up to\n28 PRs', 28],
    ['wholeFleet', 'one PR per consumer (29 repos including this one)', 29],
    ['wholeFleet', 'Delivered to all 29 repositories', 29],
    ['wholeFleet', '> Delivered to all 29 fleet\n> repos', 29],
  ]
  for (const [kind, text, expected] of reads) {
    assert.deepEqual(numbersIn(MATCHERS[kind], text), [expected], `${kind} should read ${expected} from ${JSON.stringify(text)}`)
  }

  const ignored = [
    '4 consumer repos do not yet require the Snyk gates',
    '14 consumers have a type-check script',
    'which five repos require',
    // A number closing one paragraph is not the count of the next.
    'released all 28\n\nconsumer repos',
  ]
  for (const text of ignored) {
    for (const [kind, matcher] of Object.entries(MATCHERS)) {
      assert.deepEqual(numbersIn(matcher, text), [], `${kind} must not read a count from ${JSON.stringify(text)}`)
    }
  }
})

test('the sync map and the Snyk consumer list describe the same fleet', () => {
  // The only difference between the two lists is this repo. Anything else means
  // a repo is getting one half of the fleet baseline and not the other.
  assert.deepEqual(
    snykConsumers.filter((name) => !consumerNames.includes(name)),
    ['nswds-devops'],
    'snyk-policy/repos.json should hold exactly the sync consumers plus this repo',
  )
  assert.deepEqual(
    consumerNames.filter((name) => !snykConsumers.includes(name)),
    [],
    'every sync consumer must also be enrolled in the canonical Snyk policy',
  )
})

test('every consumer sits in exactly one sync group', () => {
  // A repo in two groups receives two conflicting file sets, and the flattened
  // fleet Set hides it, so this reads the groups with duplicates kept.
  const listed = parseSyncGroupsFromSyncConfig(read('.github/sync.yml')).flat()
  assert.deepEqual(
    listed.filter((slug, index) => listed.indexOf(slug) !== index),
    [],
    'these repos are in more than one .github/sync.yml group',
  )
})

test("FLEET.md's at-a-glance counts match the sources they cite", () => {
  // The canonical statement of the fleet size, so it is read by row label rather
  // than by a prose pattern. Its numbers follow the label ("… | 28").
  const fleet = read('FLEET.md')
  assert.equal(
    glanceValue(fleet, 'Consumer repos in'),
    consumers.length,
    'FLEET.md at-a-glance consumer count disagrees with .github/sync.yml',
  )
  assert.equal(
    glanceValue(fleet, 'Repos under the canonical Snyk policy'),
    snykConsumers.length,
    'FLEET.md at-a-glance Snyk policy count disagrees with snyk-policy/repos.json',
  )
})

test('FLEET.md has exactly one member row per fleet repo', () => {
  // Rows are compared as a list, not searched for as substrings. A substring
  // search passed with a member's row deleted outright, because the slug still
  // appeared under Open issues, and it could not see a duplicated row at all.
  const rows = memberRows(read('FLEET.md'))
  const expected = [...consumerNames, 'nswds-devops']

  const duplicates = rows.filter((name, index) => rows.indexOf(name) !== index)
  assert.deepEqual(duplicates, [], 'FLEET.md lists these repos more than once')

  assert.deepEqual(
    expected.filter((name) => !rows.includes(name)),
    [],
    'FLEET.md has no member row for these fleet repos',
  )
  // The reverse matters as much: a repo shown as a member that the sync no
  // longer delivers to reads as covered while receiving nothing.
  assert.deepEqual(
    rows.filter((name) => !expected.includes(name)),
    [],
    'FLEET.md lists repos as members that are not on the sync',
  )
})

test('no prose restatement of the consumer count disagrees with .github/sync.yml', () => {
  assertAgree(claims(MATCHERS.consumer), consumers.length, 'the consumer count')
})

test('no prose restatement of the fan-out size disagrees with the consumer count', () => {
  // One PR per consumer.
  assertAgree(claims(MATCHERS.fanOut), consumers.length, 'the fan-out size')
})

test('no prose restatement of the whole fleet disagrees with the consumers plus this repo', () => {
  // The first test pins the Snyk list to exactly this set, so one number serves
  // both "the whole fleet" and "every repo under the Snyk policy".
  assertAgree(claims(MATCHERS.wholeFleet), wholeFleet, 'the whole-fleet count')
})

/** The leading number in the value cell of FLEET.md's at-a-glance row whose
 *  label starts with `label`. Throws rather than returning NaN, so a renamed row
 *  fails loudly instead of comparing NaN and passing nothing. */
function glanceValue(fleet, label) {
  const row = fleet.split('\n').find((line) => line.startsWith(`| ${label}`))
  assert.ok(row, `FLEET.md at-a-glance row "${label}" not found — update this test`)
  // Split on unescaped pipes only. Neither row read here contains one; this is
  // defensive, so a label that ever gains an escaped `\|` cannot shift the value
  // cell and read the wrong number.
  const cells = row.split(/(?<!\\)\|/).map((cell) => cell.trim())
  const value = /^(\d+)\b/.exec(cells[2] ?? '')
  assert.ok(value, `FLEET.md at-a-glance row "${label}" has no leading number: ${row}`)
  return Number(value[1])
}

/** Repo slugs in the first column of every table under "## Fleet members", in
 *  file order, duplicates kept. */
function memberRows(fleet) {
  const start = fleet.indexOf('## Fleet members')
  const end = fleet.indexOf('## Organisation repos outside the fleet')
  // Both bounds are checked explicitly. slice() with a -1 end silently runs to
  // the second-last character, which would pull the outside-the-fleet table in
  // and report its repos as phantom members instead of naming the real fault.
  assert.ok(start !== -1 && end > start, 'FLEET.md section headings moved — update this test')
  return [...fleet.slice(start, end).matchAll(/^\| `([\w.-]+)`/gm)].map((match) => match[1])
}
