// Canary for literal npm self-overrides across the fleet.
//
// A "self-override" is a package declared BOTH as a direct dependency and in
// the `overrides` block. When the override carries a literal spec
// (`"postcss": "^8.5.18"`) rather than npm's $-reference form
// (`"postcss": "$postcss"`), the repo is one upstream release away from losing
// Renovate entirely:
//
//   1. The preset disables updates to depType `overrides` (see default.json),
//      so the override stays pinned to the outgoing spec forever.
//   2. The direct dependency has depType `dependencies` and IS still updated.
//   3. Renovate applies the group with `npm install <pkg>@<new>`, and npm
//      refuses: `EOVERRIDE — Override for <pkg>@<new> conflicts with direct
//      dependency`.
//   4. Renovate throws `lockfile-error`, which ABORTS THE WHOLE REPOSITORY RUN
//      before ensureDependencyDashboard(). Not a PR annotation — a full stop.
//
// Step 4 is why this needs a canary rather than a code review. The failure is
// completely silent: no branch, no PR, no error comment, no red check, and the
// Dependency Dashboard is never rewritten, so a ticked checkbox stays ticked
// and looks ignored. reviewers, engagement and awards sat like this from
// 2026-08-06 (postcss 8.5.26) until a manual diagnosis on 2026-08-13. Outside
// the weekly schedule window the group is skipped before it can fail, so the
// repos look perfectly healthy in between.
//
// The $-reference form is immune: it resolves to the direct dependency's own
// spec, so the two cannot diverge, and it carries no version for Renovate to
// extract in the first place.
//
// SCOPE — deliberately narrow, to keep every hit actionable:
//
//   Root package.json only. npm honours `overrides` solely in the root
//   manifest; a workspace-level overrides block is ignored outright, so
//   flagging one would be a false positive (nswds-ui is the workspace repo
//   this matters for).
//
//   Top-level string values only. A nested override
//   (`{"@tailwindcss/typography": {"postcss-selector-parser": "^6.1.3"}}`)
//   gives the PARENT key no version spec and applies only inside that
//   subtree, so it cannot collide with a root direct dependency. attestation
//   and reviewers both carry nested blocks that are correct as written.
//
//   Not checked: a $-reference pointing at a package that is not a direct
//   dependency (`"foo": "$bar"` with no `bar`). npm fails that loudly on the
//   next install, so it cannot rot undetected the way this class does.
//
// Repo-local to nswds-devops — NOT synced to consumers.

import { appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ORG = 'digitalnsw'

// Every block npm resolves a direct dependency from. optionalDependencies and
// peerDependencies are included because npm's EOVERRIDE check does not care
// which block the direct dependency came from.
const DEP_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

const token = process.env.GH_TOKEN
if (!token) {
  console.error('::error::GH_TOKEN is required')
  process.exit(1)
}

const api = async (path, { raw = false } = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'user-agent': 'nswds-devops-npm-self-override-canary',
    },
  })
  if (res.status === 404) return null
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

const repos = []
for (let page = 1; ; page++) {
  const batch = await api(`/orgs/${ORG}/repos?per_page=100&page=${page}&type=all`)
  if (!batch?.length) break
  repos.push(...batch.filter((r) => !r.archived))
  if (batch.length < 100) break
}
console.log(`Scanning ${repos.length} non-archived ${ORG} repos`)

const drift = []
const unreadable = []
let inScope = 0

for (const repo of repos) {
  const name = repo.name
  const pkgText = await api(`/repos/${ORG}/${name}/contents/package.json`, { raw: true })
  if (pkgText === null) continue // not an npm repo

  let pkg
  try {
    pkg = JSON.parse(pkgText)
  } catch {
    // An npm repo whose manifest will not parse cannot be verified. Surface it
    // rather than silently counting it as healthy.
    unreadable.push({ name, reason: 'package.json did not parse' })
    continue
  }

  const overrides = pkg.overrides
  if (!overrides || typeof overrides !== 'object') continue
  inScope++

  const deps = {}
  for (const block of DEP_BLOCKS) Object.assign(deps, pkg[block] ?? {})

  const offenders = Object.entries(overrides)
    .filter(([key, value]) => typeof value === 'string' && !value.startsWith('$'))
    .filter(([key]) => key in deps)
    .map(([key, value]) => ({ pkg: key, override: value, dep: deps[key] }))

  if (offenders.length) drift.push({ name, offenders })
}

const drifted = drift.length + unreadable.length > 0

console.log(`In scope (repos with an overrides block): ${inScope}`)
console.log(`Repos with literal self-overrides:        ${drift.length}`)
console.log(`Unverifiable:                             ${unreadable.length}`)
for (const d of drift) {
  for (const o of d.offenders) {
    console.log(`  [drift]   ${d.name}: ${o.pkg} override=${o.override} dep=${o.dep}`)
  }
}
for (const u of unreadable) {
  console.log(`  [unknown] ${u.name}: ${u.reason}`)
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `drifted=${drifted}\n`)
}

if (!drifted) {
  console.log('No drift — every self-override in the fleet uses the $-reference form.')
  process.exit(0)
}

const section = (title, rows) => (rows.length ? `\n## ${title}\n\n${rows.join('\n')}\n` : '')

const issueBody = `The weekly self-override canary found ${ORG} repos where a package is declared both as a direct dependency and as a **literal-pinned** \`overrides\` entry.

Each one is a single upstream release away from losing Renovate completely. The preset disables updates to depType \`overrides\`, so the override stays pinned while the direct dependency keeps moving. The next bump runs \`npm install <pkg>@<new>\`, npm rejects it with \`EOVERRIDE — Override for <pkg>@<new> conflicts with direct dependency\`, and Renovate throws \`lockfile-error\`, which **aborts the entire repository run** before it reaches \`ensureDependencyDashboard()\`.

There is no signal when this happens: no branch, no PR, no error comment, no red check, and the Dependency Dashboard stops being rewritten, so a ticked checkbox stays ticked and reads as ignored. reviewers, engagement and awards sat broken like this for a week from 2026-08-06.
${section(
  'Literal self-overrides',
  drift.map(
    (d) =>
      `- **${d.name}**\n${d.offenders
        .map(
          (o) =>
            `  - \`${o.pkg}\` — override \`${o.override}\`, direct dependency \`${o.dep}\``,
        )
        .join('\n')}`,
  ),
)}${section(
  'Unverifiable',
  unreadable.map((u) => `- **${u.name}** — ${u.reason}`),
)}
## Fix

Replace the literal spec with npm's \`$\`-reference form, which resolves to the direct dependency's own spec:

\`\`\`json
"overrides": { "postcss": "$postcss" }
\`\`\`

The two can then never diverge, and the override carries no version for Renovate to extract at all. The effective spec is unchanged, and \`package-lock.json\` is not affected — npm does not record the overrides block in the lockfile, so no regeneration is needed.

See the \`matchDepTypes: ["overrides"]\` rule in \`default.json\` for why the preset cannot catch this itself.

_Opened automatically by \`.github/workflows/npm-self-override-canary.yml\`._
`

const bodyFile = join(process.env.RUNNER_TEMP || tmpdir(), 'npm-self-override-issue.md')
writeFileSync(bodyFile, issueBody)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `body_file=${bodyFile}\n`)
}
console.log('----- issue body -----')
console.log(issueBody)
