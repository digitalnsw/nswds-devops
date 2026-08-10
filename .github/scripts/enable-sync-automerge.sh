#!/usr/bin/env bash
# Turns on GitHub auto-merge (squash) for the file-sync fan-out PRs.
#
# Auto-merge never merges a PR that GitHub does not already consider
# mergeable, so the "Protect main" ruleset stays the gate: install, lint,
# format, test, commitlint and both Snyk contexts must all be green, and a PR
# that goes red simply sits there waiting for a human exactly as it does
# today. What this removes is the clicking, not the merge gate.
#
# Two callers, deliberately:
#   - sync.yml, right after a fan-out that did NOT touch workflow-stubs/,
#     passing the PR URLs the sync action just reported
#   - promote-v1.yml, after a successful promotion — the moment a
#     stub-carrying fan-out becomes safe to merge (see MAINTENANCE.md) — with
#     no arguments, so it sweeps whatever is still open
#
# Idempotent: re-running against a PR that already has auto-merge on is a
# no-op, so the promotion sweep can safely cover PRs sync.yml already armed.
#
# Repo-local to nswds-devops — .github/scripts/ is not part of the sync map.
#
# Usage: enable-sync-automerge.sh [pr-url ...]
#   With no arguments, discovers every open PR labelled `repo-sync` in the
#   org. Discovery goes through the search index, which lags PR creation by a
#   few seconds — fine for the promotion path, where the fan-out is minutes
#   old, which is why sync.yml passes its URLs explicitly instead.
# Requires: gh, authenticated as the sync App.
set -euo pipefail

urls=("$@")

if [ "${#urls[@]}" -eq 0 ]; then
  echo "No PR URLs given — searching for open repo-sync PRs"
  while IFS= read -r url; do
    [ -n "$url" ] && urls+=("$url")
  done < <(gh api --paginate -X GET search/issues \
    -f q='org:digitalnsw is:pr is:open label:repo-sync' \
    -f per_page=100 \
    --jq '.items[].html_url')
fi

if [ "${#urls[@]}" -eq 0 ]; then
  echo "Nothing to do — no open repo-sync PRs"
  exit 0
fi

echo "Processing ${#urls[@]} PR(s)"

armed=0
merged=0
skipped=0

for url in "${urls[@]}"; do
  # Guard against anything that isn't a fan-out PR on its own branch: the
  # label is applied by the sync action, but a human can apply a label too.
  head="$(gh pr view "$url" --json headRefName --jq '.headRefName' 2>/dev/null || echo '')"
  case "$head" in
    chore/repo-sync*) ;;
    *)
      echo "::warning::skipping ${url} — head branch '${head}' is not a repo-sync branch"
      skipped=$((skipped + 1))
      continue
      ;;
  esac

  if out="$(gh pr merge "$url" --auto --squash 2>&1)"; then
    echo "✅ ${url} — auto-merge armed"
    armed=$((armed + 1))
    continue
  fi

  # GitHub refuses to *schedule* a merge on a PR that is already mergeable
  # right now ("Pull request is in clean status"). That is the normal case on
  # the promotion path, where the fan-out has sat green for as long as the
  # promotion took, so merge it outright. Every required check is already
  # satisfied at this point; this is not a ruleset bypass.
  state="$(gh pr view "$url" --json mergeStateStatus --jq '.mergeStateStatus' 2>/dev/null || echo UNKNOWN)"
  if [ "$state" = "CLEAN" ] && gh pr merge "$url" --squash >/dev/null 2>&1; then
    echo "✅ ${url} — already green, merged"
    merged=$((merged + 1))
    continue
  fi

  # Everything else is a PR a human needs to look at: red checks, a conflict,
  # or the Snyk-never-scans-a-reopened-branch stall documented in
  # MAINTENANCE.md. Warn, never fail the run — one stuck repo must not block
  # the other twenty-four.
  echo "::warning::${url} not armed (mergeStateStatus=${state}): ${out}"
  skipped=$((skipped + 1))
done

{
  echo '## repo-sync auto-merge'
  echo "- armed: ${armed}"
  echo "- merged immediately (already green): ${merged}"
  echo "- left for a human: ${skipped}"
} >>"${GITHUB_STEP_SUMMARY:-/dev/null}"

echo "armed=${armed} merged=${merged} skipped=${skipped}"
