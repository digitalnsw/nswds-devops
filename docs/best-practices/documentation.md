# Documentation Strategy

Documentation lives **with the thing it documents**, changes **in the same
PR** as the behaviour it describes, and records **what actually happened**
over what should theoretically work.

## The house pattern (from this repo)

Documents with distinct jobs — reuse the split anywhere it fits:

| Doc | Job | Audience |
| --- | --- | --- |
| `README.md` | What this is, how it fits together | Anyone arriving |
| `FLEET.md` | The register: what exists and how each thing is configured | Anyone looking something up |
| `TECH_STACK.md` | What it is built with | Anyone assessing a change |
| `ONBOARDING.md` | How to add yourself/a repo to the system | Someone doing it once |
| `MAINTENANCE.md` | Operating model, exceptions register, and a troubleshooting table of things that *really broke* | Future maintainers at 2am |

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
- **Docs describe the present state, not the history.** No dated journal
  entries, no narration of who changed what when, no "resolved" sections: a
  fixed issue is deleted, not demoted to history, and version control holds
  the past. Where a date is genuinely part of the fact (an expiry, a
  deadline), write it absolute, never "recently".
- **Keep an incident reference when a live decision rests on it.** The rule
  above removes history, not evidence. A Renovate block, a pin, or an
  `.snyk` acceptance is parked debt whose removal condition can only be
  re-judged against the incident that motivated it, so those carry their
  issue reference and keep it — that is why every `packageRules` entry in
  [`default.json`](../../default.json) names one. The test is whether a
  reader has to reopen the reference to decide what to do next: if yes it
  stays, if it is only a record of work already finished it goes.
- Repo READMEs answer, in order: what is this, how do I run it, how do I
  test it, where does it deploy. Anything longer moves to `docs/`.
- Don't document what tooling enforces — link to the gate instead.
  Enforced rules need one sentence and a pointer; only *unenforceable*
  practice needs prose (that's why these guides exist).
