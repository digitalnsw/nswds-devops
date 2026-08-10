// Canary for conventional-changelog-conventionalcommits (ccc) pin drift.
//
// Sibling of ccc-v10-canary.mjs, pointing the other way. That probe asks "can
// we adopt v10 yet?"; this one asks "is every repo still protected from it?".
// The gap between the two is what let nswds-ui ship blank release notes for
// 4.1.4-4.3.0 and share for its only release, v1.0.0 — both undetected until a
// manual audit on 2026-08-10, because the failure mode is silent. generateNotes
// renders an empty body, semantic-release still cuts the right version, and
// every check stays green.
//
// Two independent probes, because either alone has a blind spot:
//
//   CONFIG  Resolve ccc in each repo's package-lock.json and require the ROOT
//           entry to be v9. This must read the lockfile, not package.json: the
//           nswds-ui failure declared ^9.3.1 in a workspace package and was
//           still broken, because npm installed it nested while the hoisted
//           v10 (via @commitlint/config-conventional >=21.2.0) is what the
//           preset loader at the repo root actually finds. A package.json
//           check would have passed that repo.
//
//   OUTCOME Read each repo's latest GitHub release and flag a header-only body
//           when the commits behind it include a type the preset renders. This
//           catches the class rather than the cause — any future reason notes
//           go blank, not just a ccc major.
//
// The OUTCOME probe deliberately requires a visible commit type. A release
// containing only chore/docs/style/etc. legitimately renders a bare header,
// because the conventionalcommits preset hides those types — engagement v2.0.5
// and ictds-risk v1.0.1 are both correct instances of this, and flagging them
// would train the reader to ignore the issue.
//
// Repo-local to nswds-devops — NOT synced to consumers.

import { appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ORG = 'digitalnsw'
const REQUIRED_MAJOR = 9
const PKG = 'conventional-changelog-conventionalcommits'
const ROOT_LOCK_KEY = `node_modules/${PKG}`

// Types the conventionalcommits preset renders into a section. Anything else
// (chore, docs, style, refactor, test, build, ci) is hidden by design, so a
// release built only from those is expected to have a header-only body.
const VISIBLE_TYPES = /^(feat|fix|perf|revert)(\(|!|:)/

const token = process.env.GH_TOKEN
if (!token) {
  console.error('::error::GH_TOKEN is required')
  process.exit(1)
}

const api = async (path, { raw = false, allow404 = true } = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'user-agent': 'nswds-devops-ccc-pin-drift-canary',
    },
  })
  if (res.status === 404 && allow404) return null
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`)
  return raw ? res.text() : res.json()
}

const json = async (path) => {
  const text = await api(path, { raw: true })
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Strip the `## [1.2.3](compare) (date)` / `## 1.2.3 (date)` header that
// semantic-release always emits. A blank body is NOT an empty string — the
// header alone runs to ~100 characters, which is why a naive length check
// reports zero drift fleet-wide.
const bodyWithoutHeader = (body) =>
  (body ?? '')
    .split('\n')
    .filter((line) => !/^\s*#{1,4}\s*(\[[^\]]*\]\([^)]*\)|[0-9]+\.[0-9]+\.[0-9]+)/.test(line))
    .join('\n')
    .trim()

const repos = []
for (let page = 1; ; page++) {
  const batch = await api(`/orgs/${ORG}/repos?per_page=100&page=${page}&type=all`)
  if (!batch?.length) break
  repos.push(...batch.filter((r) => !r.archived))
  if (batch.length < 100) break
}
console.log(`Scanning ${repos.length} non-archived ${ORG} repos`)

const configDrift = []
const outcomeDrift = []
const unreadable = []
let inScope = 0

for (const repo of repos) {
  const name = repo.name
  const pkg = await json(`/repos/${ORG}/${name}/contents/package.json`)
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  if (!('semantic-release' in deps)) continue
  inScope++

  // --- CONFIG probe -------------------------------------------------------
  const lock = await json(`/repos/${ORG}/${name}/contents/package-lock.json`)
  if (!lock?.packages) {
    // A semantic-release repo with no readable lockfile cannot be verified.
    // Surface it rather than silently treating it as healthy.
    unreadable.push({ name, reason: 'no readable package-lock.json' })
  } else {
    const rootVersion = lock.packages[ROOT_LOCK_KEY]?.version ?? null
    const major = rootVersion ? Number(rootVersion.split('.')[0]) : null
    if (major !== REQUIRED_MAJOR) {
      configDrift.push({
        name,
        rootVersion,
        declared: deps[PKG] ?? null,
        nested: Object.entries(lock.packages)
          .filter(([k]) => k !== ROOT_LOCK_KEY && k.endsWith(`/${PKG}`))
          .map(([k, v]) => `${k} -> ${v.version}`),
      })
    }
  }

  // --- OUTCOME probe ------------------------------------------------------
  const releases = await api(`/repos/${ORG}/${name}/releases?per_page=2`)
  const latest = releases?.[0]
  if (!latest || bodyWithoutHeader(latest.body)) continue

  // A blank release that predates the last lockfile change on a repo whose
  // config is now healthy is history, not drift — the cause was addressed
  // after it shipped, and a published body cannot be regenerated. Without
  // this, nswds-ui's 4.1.4-4.3.0 would reopen an unactionable issue every
  // week forever. If the config is NOT healthy, fall through and report:
  // the blank release is then still live evidence of a live problem.
  const healthy = !configDrift.some((d) => d.name === name)
  if (healthy) {
    const lockCommit = await api(
      `/repos/${ORG}/${name}/commits?path=package-lock.json&per_page=1`,
    )
    const lockChangedAt = lockCommit?.[0]?.commit?.committer?.date
    if (lockChangedAt && Date.parse(lockChangedAt) > Date.parse(latest.published_at)) continue
  }

  // Only a problem if the release actually contained something the preset
  // would have rendered. `previous` is absent for a repo's first release —
  // which is exactly how share v1.0.0 shipped blank — so fall back to the
  // commits reachable from the tag rather than skipping the repo.
  const previous = releases?.[1]?.tag_name
  const commits = previous
    ? (
        await api(
          `/repos/${ORG}/${name}/compare/${encodeURIComponent(previous)}...${encodeURIComponent(latest.tag_name)}`,
        )
      )?.commits
    : await api(
        `/repos/${ORG}/${name}/commits?sha=${encodeURIComponent(latest.tag_name)}&per_page=100`,
      )
  const visible = (commits ?? [])
    .map((c) => c.commit.message.split('\n')[0])
    .filter((subject) => VISIBLE_TYPES.test(subject))
  if (visible.length) {
    outcomeDrift.push({
      name,
      tag: latest.tag_name,
      first: !previous,
      visible: visible.slice(0, 5),
    })
  }
}

const drifted = configDrift.length + outcomeDrift.length + unreadable.length > 0

console.log(`In scope (semantic-release repos): ${inScope}`)
console.log(`Config drift:   ${configDrift.length}`)
console.log(`Outcome drift:  ${outcomeDrift.length}`)
console.log(`Unverifiable:   ${unreadable.length}`)
for (const d of configDrift) {
  console.log(`  [config]   ${d.name}: root ${PKG}=${d.rootVersion ?? 'ABSENT'} (declared ${d.declared ?? 'none'})`)
}
for (const d of outcomeDrift) {
  console.log(`  [outcome]  ${d.name}: ${d.tag} has a header-only body but ${d.visible.length} visible commit(s)`)
}
for (const d of unreadable) {
  console.log(`  [unknown]  ${d.name}: ${d.reason}`)
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `drifted=${drifted}\n`)
}

if (!drifted) {
  console.log('No drift — every semantic-release repo resolves ccc v9 at the root.')
  process.exit(0)
}

const section = (title, rows) => (rows.length ? `\n## ${title}\n\n${rows.join('\n')}\n` : '')

const issueBody = `The weekly pin-drift canary found ${ORG} repos that are no longer protected from \`${PKG}\` v10, or that have already shipped a blank release.

Preset v10's render-function templates are incompatible with \`@semantic-release/release-notes-generator@14\`: commit analysis still computes the correct release type, but \`generateNotes\` emits an empty body. Nothing goes red — the release just ships blank. See the block rule in \`default.json\`.
${section(
  'Config drift — root resolution is not v9',
  configDrift.map(
    (d) =>
      `- **${d.name}** — root \`${PKG}\` resolves to \`${d.rootVersion ?? 'ABSENT'}\`, declared \`${d.declared ?? 'no direct pin'}\`.${
        d.nested.length ? `\n  Nested copies: ${d.nested.map((n) => `\`${n}\``).join(', ')}` : ''
      }`,
  ),
)}${section(
  'Outcome drift — latest release has a header-only body',
  outcomeDrift.map(
    (d) =>
      `- **${d.name}** \`${d.tag}\`${d.first ? ' (the repo\'s first release)' : ''} rendered no body, but the release contained renderable commits:\n${d.visible.map((v) => `  - \`${v}\``).join('\n')}`,
  ),
)}${section(
  'Unverifiable',
  unreadable.map((d) => `- **${d.name}** — ${d.reason}`),
)}
## Fix

Add a direct **root** devDependency pin and regenerate the lockfile:

\`\`\`json
"${PKG}": "^9.3.1"
\`\`\`

The pin must be at the repo root. A workspace-level declaration is not enough — semantic-release runs from the root, so the preset loader resolves the hoisted copy and a nested one never applies. Confirm with \`npm ls ${PKG}\`: v9 at the root, with v10 nested under \`@commitlint/config-conventional\` (where commitlint keeps working).

Already-published blank releases cannot be regenerated; fix forward.

_Opened automatically by \`.github/workflows/ccc-pin-drift-canary.yml\`._
`

const bodyFile = join(process.env.RUNNER_TEMP || tmpdir(), 'ccc-pin-drift-issue.md')
writeFileSync(bodyFile, issueBody)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `body_file=${bodyFile}\n`)
}
console.log('----- issue body -----')
console.log(issueBody)
