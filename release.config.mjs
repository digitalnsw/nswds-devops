// breakingHeaderPattern is load-bearing: semantic-release's bundled
// conventional-commits parser does not honour the `type!:` bang on its own,
// so without this pattern a `feat!:` commit is released as a MINOR bump
// instead of a MAJOR one (this shipped a breaking change as a minor release
// in @nswds/tokens v2.33.0 — see nswds-tokens#79). Do not remove it when
// upgrading semantic-release without re-verifying bang-commit handling.
//
// notesPattern is load-bearing for the opposite reason: it stops ORDINARY PROSE
// declaring a breaking change. semantic-release bundles
// conventional-commits-parser v6, whose default note regex is
// `^[\s|*]*(KEYWORDS)[:\s]+(.*)` — case-insensitive, and `[:\s]+` accepts a
// SPACE where the Conventional Commits footer requires a colon. So any body
// line beginning "breaking changes ..." declared a breaking change and took the
// rest of the sentence as its description.
//
// It shipped two false majors. digitalnsw/engagement v2.0.0 came off a Renovate
// `fix(deps)` bump whose body said the breaking changes "do not affect this
// repo" — the sentence saying nothing broke is what broke it. digitalnsw/
// nswds-email v3.0.0 came off a refactor. Neither was noticed for weeks.
//
// Requiring the colon fixes both while keeping every real footer working, and
// the leading `[\s|*]*` is kept because a squashed PR body arrives bulleted.
// Two things are kept deliberately, both because MISSING a real breaking change
// is worse than the prose this costs. Case-insensitivity stays, so a lowercase
// `breaking change:` still counts. The keyword list is untouched, including the
// bare `BREAKING`: with a colon required it can no longer match prose, and
// dropping it would silently stop honouring `BREAKING: x`.
//
// Commitlint cannot stand in for any of this: it resolves parser v7, which
// already requires the colon, so it parses these messages differently from the
// tool that acts on them. tools/release-config.test.mjs pins the behaviour.
const parserOpts = {
  noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
  notesPattern: (keywords) => new RegExp(`^[\\s|*]*(${keywords}):\\s+(.*)`, 'i'),
  breakingHeaderPattern: /^(\w+)(?:\(([^)]*)\))?!: (.*)$/,
}

const releaseConfig = {
  branches: ['main'],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        parserOpts,
        releaseRules: [
          { breaking: true, release: 'major' },
          { type: 'style', release: 'patch' },
        ],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        parserOpts,
      },
    ],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
      },
    ],
    // '@semantic-release/npm',
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    ['@semantic-release/github', { successComment: false, failComment: false }],
  ],
}

export default releaseConfig
