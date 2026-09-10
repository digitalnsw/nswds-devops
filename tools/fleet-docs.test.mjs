// Structural guards for the fleet counts stated in the documentation.
//
// The docs restate the size of the fleet in a dozen places: "28 consumer
// repos", "29 repos including this one", "the 20 repos not listed below", one
// table row per member in FLEET.md. Every one of those is a copy of a fact that
// actually lives in .github/sync.yml and snyk-policy/repos.json, and copies rot
// the moment a repo is added — silently, because nothing reads them.
//
// That is not hypothetical. Before FLEET.md existed the same count was written
// as 21, 24, 25 and 26 in four different files at once, and each number was
// right on the day it was written. A reader has no way to tell which one is
// current, so the whole set stops being trustworthy together.
//
// WHAT THIS FILE CAN AND CANNOT DO, in the same spirit as the header of
// renovate-preset.test.mjs:
//
//   CAN  — assert that every number the docs state about fleet SIZE, and every
//          repo they enumerate, agrees with the two machine-readable sources in
//          this repo. Those sources are the inputs the sync and the Snyk
//          fan-out actually run on, so agreement with them is the real thing,
//          not a proxy.
//   CANNOT — assert that anything the docs SAY about a repo is true: its
//          purpose, its live URL, its Vercel projects, its required checks, the
//          version of a package it consumes. All of that lives in GitHub, npm
//          and Vercel and drifts without a commit here. Checking it is canary
//          work against the live APIs, not unit-test work.
//
// One limit inside the CAN, stated because missing it is how the first version
// of this file overclaimed. The two fleet-size rows of FLEET.md's at-a-glance
// table, and its member rows, are parsed structurally, so they are covered
// however they are worded. The table's other rows (npm publishers, Vercel) are
// CANNOT items above and are not checked at all. Prose counts
// are found by pattern, so a count written in a phrasing no pattern here knows
// is invisible until one is added. When you state the fleet size somewhere new,
// check that `npm test` fails if you change the number.
//
// So a green run here means the docs are counting the same fleet the tooling
// is. It does not mean the rest of FLEET.md is accurate.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

import { parseFleetFromSyncConfig } from './renovate-fleet-dashboard.mjs'

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

/** Every markdown file whose prose is in scope, plus the sync map's own header
 *  comment — it states the count too, and drifts the same way. */
const docs = [
  'README.md',
  'FLEET.md',
  'TECH_STACK.md',
  'ONBOARDING.md',
  'MAINTENANCE.md',
  '.github/sync.yml',
  'docs/config-single-source-of-truth.md',
  ...readdirSync(path.join(root, 'docs/best-practices'))
    .filter((file) => file.endsWith('.md'))
    .map((file) => `docs/best-practices/${file}`),
]

/** Report the file and line of every match so a failure names where to edit,
 *  rather than only what the right number would have been. */
function claims(pattern) {
  const found = []
  for (const doc of docs) {
    read(doc)
      .split('\n')
      .forEach((line, index) => {
        for (const match of line.matchAll(pattern)) {
          // A pattern may be an alternation, in which case only one of its
          // groups captured. Take the first that did, rather than group 1,
          // which would silently read NaN for every other branch.
          const captured = match.slice(1).find((group) => group !== undefined)
          found.push({ doc, line: index + 1, stated: Number(captured), text: line.trim() })
        }
      })
  }
  return found
}

function assertAll(found, expected, what) {
  assert.ok(found.length > 0, `no "${what}" claims found — did the wording change?`)
  const wrong = found.filter((claim) => claim.stated !== expected)
  assert.deepEqual(
    wrong.map((claim) => `${claim.doc}:${claim.line} says ${claim.stated}`),
    [],
    `${what} is ${expected}; these disagree`,
  )
}

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

test("FLEET.md's at-a-glance counts match the sources they cite", () => {
  // This table is the register's headline, so it is read by row label rather
  // than by a prose pattern. Its numbers follow the label ("… | 28"), which is
  // exactly the shape a "28 consumers" style matcher cannot see — the first
  // version of this file left both rows unguarded for that reason.
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

test('every stated consumer count matches .github/sync.yml', () => {
  // "28 consumer repos", "28 consumer repositories" and bare "28 consumers" are
  // all the same claim; the `\b` keeps "consumers" from matching mid-word.
  assertAll(claims(/(\d+) consumer(?:s\b| repo)/g), consumers.length, 'the consumer count')
})

test('every stated fan-out size matches the consumer count', () => {
  // "fans out to 28 repos", "up to 28 PRs" — one PR per consumer.
  assertAll(
    claims(/fans out to (\d+) repos|fans out as up to (\d+) PRs/g),
    consumers.length,
    'the fan-out size',
  )
})

test('every stated whole-fleet count matches the consumers plus this repo', () => {
  // "29 repos including this one", "Delivered to all 29 repos", "all 29 fleet
  // repos", and TECH_STACK's "all 29 repos" for semantic-release are all the
  // whole fleet. The first test pins the Snyk list to exactly this set, so one
  // number serves both.
  assertAll(
    claims(/(\d+) repos including this one|all (\d+) (?:fleet )?repos\b/g),
    wholeFleet,
    'the whole-fleet count',
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

test('the group sizes stated in README.md add up to the fleet', () => {
  // README describes group 1 as "the N repos not listed below". Every consumer
  // is in exactly one group, so group 1 is the fleet minus the named groups.
  const groups = parseSyncGroups(read('.github/sync.yml'))
  const groupOne = groups[0]
  assert.ok(groupOne, 'no groups parsed from .github/sync.yml')

  const stated = /the (\d+) repos not listed below/.exec(read('README.md'))
  assert.ok(stated, 'README.md no longer describes group 1 by size — update this test')
  assert.equal(
    Number(stated[1]),
    groupOne.length,
    'README.md group 1 size disagrees with .github/sync.yml',
  )

  const total = groups.reduce((sum, group) => sum + group.length, 0)
  assert.equal(total, consumers.length, 'the sync groups do not partition the fleet')
})

/** The leading number in the value cell of FLEET.md's at-a-glance row whose
 *  label starts with `label`. Throws rather than returning NaN, so a renamed row
 *  fails loudly instead of comparing NaN and passing nothing. */
function glanceValue(fleet, label) {
  const row = fleet.split('\n').find((line) => line.startsWith(`| ${label}`))
  assert.ok(row, `FLEET.md at-a-glance row "${label}" not found — update this test`)
  // Cells are split on unescaped pipes only; the Node baseline row escapes its
  // own `\|\|`, and a naive split would shift every cell after it.
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

/** Consumers per `repos: |` block, in file order. Deliberately a second, simpler
 *  parser than parseFleetFromSyncConfig: that one flattens every block into one
 *  set, and group sizes need them kept apart. */
function parseSyncGroups(yaml) {
  const groups = []
  let current = null
  let blockIndent = null

  for (const line of yaml.split('\n')) {
    if (/^\s*-?\s*repos:\s*\|/.test(line)) {
      blockIndent = line.search(/\S/)
      current = []
      groups.push(current)
      continue
    }
    if (blockIndent === null) continue
    if (!line.trim()) continue
    if (line.search(/\S/) <= blockIndent) {
      blockIndent = null
      continue
    }
    const match = /^([\w.-]+\/[\w.-]+)$/.exec(line.trim())
    if (match) current.push(match[1])
  }
  return groups
}
