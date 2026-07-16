# Release Strategy

Releases are **continuous and automatic**: every push to `main` runs the
release workflow; semantic-release decides from the commits whether a
release ships ([Semantic Versioning](semantic-versioning.md)). There is no
release day, no release branch, no human version bump.

## The pipeline (stock repos)

The synced `release.yml` stub calls `reusable-release.yml@v1` here:

1. Checkout — over SSH with `RELEASE_DEPLOY_KEY` where `main` is
   ruleset-protected (the deploy key is a bypass actor; the default
   `GITHUB_TOKEN` cannot push through required checks).
2. Node from `.nvmrc`, `npm clean-install`, `npm audit signatures`.
3. `npx semantic-release` (with `HUSKY=0`) — computes the version, writes
   the changelog, tags, creates the GitHub Release, publishes to npm where
   enabled, and pushes `chore(release): x.y.z [skip ci]`.

One release at a time: the job runs under a `release` concurrency group,
queued and **never cancelled mid-publish** (a cancelled run can tag without
publishing).

## Bespoke pipelines

nswds-ui and nswds-tokens publish packages with extra verification and keep
their own `release.yml` (same deploy-key checkout pattern);
ictds-portal-flows' `release.yml` is a Power Platform production deploy —
its semantic-release lives in `semantic-release.yml`. Never overwrite these
via the sync map; the group layout in `.github/sync.yml` encodes this.

## Practices

- **Loud failures**: release failures happen post-merge where nobody is
  watching. The bespoke pipelines file/bump a `release-failure` issue and
  verify npm actually matches the newest tag — copy that pattern anywhere a
  silent failure would strand consumers (three releases once failed
  unnoticed).
- **Rollback = roll forward**: ship a `revert:`/`fix:` release. Never delete
  tags or releases — consumers may already have them.
- **Shared-CI releases are a second deploy step**: merging here versions the
  repo, but consumers only get workflow changes when the `v1` tag moves
  ([GitHub Actions](github-actions.md)).
- **Key hygiene**: rotate a repo's release deploy key by generating a new
  keypair, replacing the deploy key and `RELEASE_DEPLOY_KEY` secret
  (procedure in [MAINTENANCE.md](../../MAINTENANCE.md)).
