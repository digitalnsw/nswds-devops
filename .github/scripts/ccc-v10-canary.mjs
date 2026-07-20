// Canary for the conventional-changelog-conventionalcommits (ccc) v10 block.
//
// The fleet pins ccc to ^9 because preset v10's render-function templates emit
// an empty changelog body under @semantic-release/release-notes-generator —
// commit analysis still computes the right release type, but generateNotes
// renders nothing. default.json documents the block and release.config.mjs
// carries the same note; it is tracked upstream as release-notes-generator#992.
//
// This probe installs the LATEST release-notes-generator + ccc into a scratch
// dir (deliberately ignoring the repo's pins) and renders notes for synthetic
// commits using the fleet's shared parserOpts. A blank changelog still emits the
// `## [version]` compare header, so a non-empty string is NOT the signal — we
// look for a section heading (`### `) or a commit bullet (`* `), which only
// appear when the writer's render functions are honoured. While the bug persists
// the probe stays quiet (resolved=false, exit 0); the day a published release
// renders real content again it flips resolved=true and writes an issue body for
// the workflow to file.
//
// Repo-local to nswds-devops — NOT synced to consumers.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const RNG = '@semantic-release/release-notes-generator@latest'
const CCC = 'conventional-changelog-conventionalcommits@latest'

// Mirror release.config.mjs so the probe renders exactly as a real release does.
const parserOpts = {
  noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
  breakingHeaderPattern: /^(\w+)(?:\(([^)]*)\))?!: (.*)$/,
}

const dir = mkdtempSync(join(tmpdir(), 'ccc-canary-'))
writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify({ name: 'ccc-canary', version: '0.0.0', private: true, type: 'module' }),
)

execFileSync('npm', ['install', '--no-audit', '--no-fund', '--prefix', dir, RNG, CCC], {
  stdio: 'inherit',
})

const pkgVersion = (name) =>
  JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')).version

const rngVer = pkgVersion('@semantic-release/release-notes-generator')
const cccVer = pkgVersion('conventional-changelog-conventionalcommits')

const rngUrl = pathToFileURL(
  join(dir, 'node_modules/@semantic-release/release-notes-generator/index.js'),
)
const { generateNotes } = await import(rngUrl)

const commits = [
  { hash: '0'.repeat(40), message: 'feat(ci): add a probe feature\n\nprobe body' },
  { hash: '1'.repeat(40), message: 'fix(core): correct a probe bug\n\nprobe body' },
  { hash: '2'.repeat(40), message: 'feat!: a breaking probe change\n\nprobe body' },
]

const context = {
  cwd: dir,
  env: process.env,
  logger: { log() {}, error() {} },
  options: { repositoryUrl: 'https://github.com/digitalnsw/nswds-devops.git' },
  lastRelease: { gitTag: 'v1.0.0', gitHead: 'a'.repeat(40), version: '1.0.0' },
  nextRelease: { gitTag: 'v1.1.0', gitHead: 'b'.repeat(40), version: '1.1.0', type: 'minor' },
  commits,
}

const notes = await generateNotes({ preset: 'conventionalcommits', parserOpts }, context)

// Drop the version/compare header line; anything left that is a heading or a
// bullet means the render functions ran.
const body = notes
  .split('\n')
  .filter((line) => !line.startsWith('## '))
  .join('\n')
const resolved = /^### |^\* /m.test(body)

console.log(
  `release-notes-generator@${rngVer} + conventional-changelog-conventionalcommits@${cccVer}`,
)
console.log(`resolved=${resolved}`)
console.log('----- rendered notes -----')
console.log(notes || '(empty)')

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `resolved=${resolved}\nrng=${rngVer}\nccc=${cccVer}\n`,
  )
}

if (resolved) {
  const bodyFile = join(process.env.RUNNER_TEMP || tmpdir(), 'ccc-canary-issue.md')
  const issueBody = `The weekly canary rendered non-empty release notes with the latest toolchain:

- \`@semantic-release/release-notes-generator@${rngVer}\`
- \`conventional-changelog-conventionalcommits@${cccVer}\`

That means the v10 block documented in \`default.json\` can be lifted.

## Exit steps

1. Remove the \`conventional-changelog-conventionalcommits\` major-block rule in \`default.json\`.
2. Bump the direct \`^9.3.1\` devDependency pin to the new major across all 16 semantic-release repos.
3. Verify a release on one repo renders a real changelog body before fanning out.

## Rendered sample

\`\`\`markdown
${notes}
\`\`\`

_Opened automatically by \`.github/workflows/ccc-v10-canary.yml\`._
`
  writeFileSync(bodyFile, issueBody)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `body_file=${bodyFile}\n`)
  }
}
