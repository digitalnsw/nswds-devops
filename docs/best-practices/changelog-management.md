# Changelog Management Strategy

The changelog exists so consumers can answer "what changed and does it
affect me?" without reading diffs — clear, human-readable, and current on
every release, with zero manual upkeep.

Changelogs are **generated, never hand-written**. On every release,
semantic-release's changelog plugin prepends the release's commits to
`CHANGELOG.md`, and the same notes become the GitHub Release body. The bot
commits the file as part of `chore(release): x.y.z [skip ci]`.

## Consequences

- **The changelog is only as good as the commit subjects.** "fix: correct
  focus ring colour on dark buttons" reads well; "fix: pr feedback" reads
  forever. Review PR titles as changelog entries
  ([Commit Messages](commit-messages.md)).
- **Never edit `CHANGELOG.md` by hand.** Manual edits are stomped or
  orphaned by the next release commit. If a published entry is wrong, the
  fix is a follow-up release with a correct message (and, if needed, editing
  the GitHub Release body, which is not regenerated).
- `docs:`, `chore:`, `test:` etc. don't release, so they never appear in the
  changelog — if a change deserves an entry, it deserves a releasing type.
- Breaking changes get their own section automatically from the
  `BREAKING CHANGE:` footer — write that footer as migration instructions,
  because it's exactly what consumers will read.

## Where to look

- `CHANGELOG.md` in each repo — cumulative history.
- GitHub Releases — per-version notes, with assets where relevant.
- For this repo, the changelog doubles as the deploy history of the shared
  tooling — check it before moving the `v1` tag.
