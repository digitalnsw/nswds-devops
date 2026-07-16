# Testing Strategy

> **Status: baseline enforced, depth per-repo.** Every repo gets the shared
> merge gate; test depth beyond that varies by repo maturity. This guide
> states the floor and the direction.

## The enforced floor (every repo)

The required `install / install` check validates every PR's test merge:
no conflict markers anywhere, `npm clean-install` succeeds (lockfile matches
manifest), and the build compiles where enabled. That's integrity testing —
it catches broken states, not wrong behaviour.

## The expectation

- **If a repo has a test suite, it runs in CI on every PR** — a suite that
  only runs on laptops is documentation, not a gate. Wire it as an
  additional job in the repo's own workflow and consider adding it to the
  repo's required checks once it's stable.
- **`npm test` is the entry point** — whatever the framework, the command is
  uniform ([Command Documentation](command-documentation.md)).
- **Test the contract, not the internals.** Libraries (tokens, ui): public
  API surface, package exports, artefact integrity — nswds-tokens'
  `Package surface` / `check:dist` / `Validate tokens` jobs are the model.
  Apps: route-level smoke tests over unit-testing framework glue.
- **Bug fixes come with the test that would have caught them.** The shared
  tooling models this culture in CI form — every troubleshooting entry in
  MAINTENANCE.md became a permanent check (release verification, npm/tag
  drift audits, commit-type sync).
- Visual/UI regression where pixels are the product: nswds-ui runs
  Chromatic visual regression per PR; that's the pattern for
  design-system repos.

## What we deliberately don't do

- No coverage-percentage gates — they optimise for the metric. Review asks
  "is the changed behaviour tested?" instead.
- No E2E-everything — env-dependent app builds already can't run in bare CI
  (`CI_SKIP_BUILD` repos); their behavioural testing belongs in the deploy
  platform's preview environment, not the merge gate.
