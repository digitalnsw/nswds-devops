# Documentation Strategy

Documentation lives **with the thing it documents**, changes **in the same
PR** as the behaviour it describes, and records **what actually happened**
over what should theoretically work.

## The house pattern (from this repo)

Three documents with distinct jobs — reuse the split anywhere it fits:

| Doc | Job | Audience |
| --- | --- | --- |
| `README.md` | What this is, how it fits together | Anyone arriving |
| `ONBOARDING.md` | How to add yourself/a repo to the system | Someone doing it once |
| `MAINTENANCE.md` | Operating model + troubleshooting table of things that *really broke*, in the order they broke | Future maintainers at 2am |

The troubleshooting-table pattern is the most valuable one: every incident
becomes a row (symptom → cause → fix) the day it happens. It costs one
minute while the context is fresh and saves hours later.

## Rules

- **Docs change in the PR that changes behaviour** — a follow-up "update
  docs" PR is a doc that's already wrong for one release. These
  best-practice guides follow the same rule (see the note in the
  [index](README.md)).
- **Load-bearing lines get comments where they live**, not in a wiki —
  config comments survive refactors and reviews; wikis rot
  ([Coding Practices](coding-practices.md)).
- **Generated docs stay generated** — `CHANGELOG.md` is the bot's
  ([Changelog Management](changelog-management.md)).
- **Convert relative time to absolute** — "as of 2026-07-16" ages fine;
  "recently" doesn't.
- Repo READMEs answer, in order: what is this, how do I run it, how do I
  test it, where does it deploy. Anything longer moves to `docs/`.
- Don't document what tooling enforces — link to the gate instead.
  Enforced rules need one sentence and a pointer; only *unenforceable*
  practice needs prose (that's why these guides exist).
