// breakingHeaderPattern is a DEFENSIVE FALLBACK for the `type!:` bang. It was
// load-bearing when it was added: the bundled parser did not honour the bang on
// its own, and a `feat!:` shipped as a MINOR — that is how a breaking change
// went out as @nswds/tokens v2.33.0 (nswds-tokens#79).
//
// On the current dependency set it no longer is. Deleting it leaves the bang
// assertions in tools/release-config.test.mjs passing, because the
// conventionalcommits preset now handles the bang itself. Keep it anyway, for
// the version that stops doing so — but the thing to re-verify when upgrading
// semantic-release is that `feat!:` still majors, not that this line is what
// makes it.
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
// nswds-email v3.0.0 came off a refactor. The engagement one stood for six
// weeks before anyone noticed; the nswds-email one was caught the same day,
// which is the only reason this exists.
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
// Exported so .github/scripts/ccc-v10-canary.mjs can render its probe with the
// REAL options instead of a copy. The copy had already drifted from this file
// once, which would have had the canary answer "is the ccc v10 pin safe to
// lift?" against a configuration no release actually uses. Consumers of the
// synced copy of this file do not import it; the export is inert there.
export const parserOpts = {
  // `BREAKING-CHANGE` is the Conventional Commits spec's synonym for
  // `BREAKING CHANGE`. The preset honours it by default; replacing the default
  // with a hand-written list dropped it, so a correctly written
  // `BREAKING-CHANGE:` footer released as a PATCH — the inverse of the prose
  // trap, and the worse direction, since consumers upgrade automatically into
  // the break. With notesPattern requiring the colon it cannot match prose such
  // as "breaking-change handling is unchanged".
  noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING-CHANGE', 'BREAKING'],
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
