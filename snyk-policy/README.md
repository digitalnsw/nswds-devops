# Canonical Snyk policy

One source of truth for the `.snyk` policy every consumer repo carries.

- **`base.snyk`** — the canonical block. Ends with a `  # repo-specific`
  marker; everything above it is fleet policy.
- **`repos.json`** — who receives it, plus any one-time migration directives.

## How delivery works

`.snyk` is a **Mechanism C** file (see
[`docs/config-single-source-of-truth.md`](../docs/config-single-source-of-truth.md)):
part shared policy, part policy the repo genuinely owns. The ordinary file-sync
in `.github/sync.yml` overwrites whole files and would delete the second half,
which is why `.snyk` is not in it.

Instead, `.github/scripts/snyk-policy.mjs` rewrites **only** the canonical
block and copies the tail through byte-for-byte:

```
[ canonical block, regenerated from base.snyk ]
  # repo-specific          <- marker, last line of the block
[ tail, never parsed, never reordered, never reformatted ]
```

The only byte the sync may add to the tail is a trailing newline, when the file
would otherwise not end in one. Trailing blank lines are left exactly as found.

`.github/workflows/snyk-policy-sync.yml` opens one PR per repo when this
directory changes. `.github/workflows/snyk-policy-canary.yml` probes weekly for
drift the fan-out would not otherwise see — a block edited directly in a
consumer, or a repo added to the fleet without policy.

## Common tasks

**Change fleet policy.** Edit `base.snyk`, merge to `main`. The fan-out opens
the PRs. Never edit the block in a consumer repo: it is overwritten on the next
fan-out and reported by the canary in the meantime.

**Add a repo.** Add a key to `repos.json`. The sync creates `.snyk` if absent.
If the repo already has one written before this convention, give it a `migrate`
directive, including the `fromSha` of the file it targets:

```bash
gh api /repos/digitalnsw/<repo>/contents/.snyk --jq .sha
```

It stops applying once that repo's first PR has merged and the blob changes,
and `--check` will remind you to delete the now-inert entry. If the file
changes on main *before* the migration lands, the run refuses that repo and
tells you to refresh `fromSha` — that is the safety behaviour working, not a
bug.

**Check without changing anything:**

```bash
GH_TOKEN=$(gh auth token) node .github/scripts/snyk-policy.mjs --check
```

**Preview the PRs without opening them:**

```bash
GH_TOKEN=$(gh auth token) node .github/scripts/snyk-policy.mjs --apply --dry-run
```

## Rules that are load-bearing

- **Never add a `'*:lic:*'` catch-all.** Snyk matches ignore keys as exact
  issue IDs and does not support globs. A catch-all matches nothing while
  reading as protection — four repos carried one and were failing every licence
  finding anyway. Licence findings must be enumerated.
- **A `migrate` directive fires only on an exact `fromSha` match.** It names
  the one blob it was written against, so it can run at most until the first
  fan-out merges and never again — a forgotten entry cannot delete policy the
  repo added later. Converted-state is deliberately *not* inferred from the
  file's contents: a consumer that edited the canonical block would make a
  spent directive look live again. A directive whose SHA no longer matches a
  file that is not in canonical shape is **refused**, never guessed at.
- **Scope vulnerability ignores to a dependency path, not `'*'`,** whenever the
  rationale is conditional on how the package is reached. Enumerate the real
  paths with `npx snyk test --ignore-policy --json` — an incomplete path set
  does not error, the advisory just comes back.
- **Do not re-add the nanoid CWE-835 ignores.** They are obsolete, not expired;
  the reasoning is in `base.snyk` and in the Mechanism C section of the config
  doc.

Unit tests: `tools/snyk-policy.test.mjs` (`npm test`).
