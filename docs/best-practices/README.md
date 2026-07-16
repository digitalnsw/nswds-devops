# Development Best Practice guides

How we build, review, and ship across the digitalnsw repos. These guides
describe the conventions **enforced by the shared tooling in this repo**
(file-sync + reusable workflows + branch rulesets) plus the practices we
expect humans to follow around them. Where a guide proposes a practice we
have not adopted org-wide yet, it says so at the top.

| Guide | Enforced by tooling? |
| --- | --- |
| [Coding Practices](coding-practices.md) | Partly (lint/format gates) |
| [Command Documentation](command-documentation.md) | Convention |
| [GitHub Actions Documentation](github-actions.md) | Yes (synced stubs + reusables) |
| [Linting & Formatting Rules](linting-and-formatting.md) | Yes (CI gates) |
| [Semantic Versioning Strategy](semantic-versioning.md) | Yes (semantic-release) |
| [Branch Naming Strategy](branch-naming.md) | Yes (validate-branch-name) |
| [Commit Message Strategy](commit-messages.md) | Yes (commitlint + husky) |
| [Pull Request (PR) Strategy](pull-requests.md) | Yes (branch rulesets) |
| [Code Review Strategy](code-review.md) | Partly (Copilot review ruleset) |
| [Feature Flag Strategy](feature-flags.md) | Proposed baseline |
| [Changelog Management Strategy](changelog-management.md) | Yes (semantic-release) |
| [Testing Strategy](testing.md) | Partly (per-repo) |
| [Dependency Management Strategy](dependency-management.md) | Yes (Renovate + Snyk + install gate) |
| [Environment Strategy](environments.md) | Partly |
| [Documentation Strategy](documentation.md) | Convention |
| [Release Strategy](releases.md) | Yes (reusable release workflow) |

Change process: these guides live with the tooling on purpose. If a PR here
changes enforced behaviour (a workflow, a config, a script), update the
matching guide in the same PR.

These guides are mirrored automatically to Confluence (GDS space →
Application Support → Development Best Practice) on every merge to
`main` — the repo is the source of truth; never edit the Confluence
copies.
