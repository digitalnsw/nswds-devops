# Semantic Versioning Strategy

Versions are **computed, never chosen**. semantic-release derives the next
version from the conventional commits landed on `main` since the last
release — nobody edits a version number by hand.

## Bump rules

| Commit on main | Release |
| --- | --- |
| `feat:` | minor |
| `fix:`, `perf:`, `style:` | patch |
| `feat!:` / `BREAKING CHANGE:` footer | **major** |
| `docs:`, `chore:`, `test:`, `build:`, `ops:`, `refactor:` | none |

Configured in `release.config.mjs` (`releaseRules`; `style → patch` is a
deliberate addition so formatting-only fixes still ship).

## The bang-commit gotcha (do not re-learn this)

semantic-release's bundled parser does **not** honour the `type!:` bang on
its own. `release.config.mjs` carries a custom `breakingHeaderPattern` so
`feat!:` actually majors — without it a breaking change shipped as a minor
(`@nswds/tokens` v2.33.0, nswds-tokens#79). Never remove that pattern when
upgrading semantic-release without re-verifying bang handling.

## Practices

- **Think about the version when you write the commit.** The squash-merge PR
  title becomes the commit that decides the bump — a breaking change hidden
  under a `fix:` title ships as a patch and breaks consumers.
- Breaking changes: use `type!: subject` *and* spell out the migration in a
  `BREAKING CHANGE:` footer — that text becomes the release notes.
- Release commits (`chore(release): x.y.z [skip ci]`) are made by the bot,
  ignored by commitlint, and pushed via the release deploy key. Don't
  imitate them by hand.
- Version tags and GitHub Releases are created by semantic-release only.
  Manually pushed `v*` tags will desync npm and git and trip the
  release-verification checks (nswds-tokens/nswds-ui poll npm to catch
  exactly this).
