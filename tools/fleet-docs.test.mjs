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

test('every stated consumer count matches .github/sync.yml', () => {
  assertAll(claims(/(\d+) consumer repo/g), consumers.length, 'the consumer count')
})

test('every stated fan-out size matches the consumer count', () => {
  // "fans out to 28 repos", "up to 28 PRs" — one PR per consumer.
  assertAll(
    claims(/fans out to (\d+) repos|fans out as up to (\d+) PRs/g),
    consumers.length,
    'the fan-out size',
  )
})

test('every stated Snyk policy count matches snyk-policy/repos.json', () => {
  assertAll(
    claims(/(\d+) repos including this one|Delivered to all (\d+) repos/g),
    snykConsumers.length,
    'the Snyk policy consumer count',
  )
})

test('FLEET.md has a row for every consumer and invents none', () => {
  const fleet = read('FLEET.md')
  // Members are named in backticks in the tables. A slug that differs from the
  // local folder name (data, images) is written as the slug, which is what
  // sync.yml and repos.json use — that consistency is the point of the file.
  const missing = consumerNames.filter((name) => !fleet.includes(`\`${name}\``))
  assert.deepEqual(missing, [], 'FLEET.md is missing a row for these consumers')

  // Catch the reverse too: a repo listed as a fleet member that the sync no
  // longer delivers to would read as covered while receiving nothing.
  const membersSection = fleet.slice(
    fleet.indexOf('## Fleet members'),
    fleet.indexOf('## Organisation repos outside the fleet'),
  )
  assert.ok(membersSection.length > 0, 'FLEET.md section headings moved — update this test')
  const listed = [...membersSection.matchAll(/^\| `([\w.-]+)`/gm)].map((match) => match[1])
  const phantom = listed.filter(
    (name) => !consumerNames.includes(name) && name !== 'nswds-devops',
  )
  assert.deepEqual(phantom, [], 'FLEET.md lists repos that are not on the sync')
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
