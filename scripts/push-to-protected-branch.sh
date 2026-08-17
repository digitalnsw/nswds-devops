#!/usr/bin/env bash
# Temporarily disable a repo's branch rulesets, push, and re-enable them.
#
# This is the sanctioned two-step from MAINTENANCE.md ("Ruleset bypass
# policy") for the case where the default branch must take a push while CI
# is broken. It is deliberately NOT a standing exemption: protection is off
# only for the duration of the push, every original ruleset definition is
# backed up first, and an EXIT trap restores them even on error or Ctrl-C.
#
# Usage:
#   ./push-to-protected-branch.sh                 # prompts for the repo
#   ./push-to-protected-branch.sh digitalnsw/agile
set -uo pipefail

BACKUP_DIR="${TMPDIR:-/tmp}/ruleset-backup-$$"
RESTORED=0
IDS=()
REPO=""

restore() {
  [ "$RESTORED" = 1 ] && return
  [ "${#IDS[@]}" -eq 0 ] && return
  RESTORED=1
  echo
  echo "Restoring rulesets…"
  local failed=0
  for id in "${IDS[@]}"; do
    if jq '{name, target, enforcement, conditions, rules, bypass_actors}' \
         "$BACKUP_DIR/$id.json" \
         | gh api -X PUT "repos/$REPO/rulesets/$id" --input - >/dev/null 2>&1; then
      echo "  restored ruleset $id ($(jq -r .name "$BACKUP_DIR/$id.json"))"
    else
      echo "  !! FAILED to restore ruleset $id" >&2
      failed=1
    fi
  done
  if [ "$failed" = 1 ]; then
    echo
    echo "!! One or more rulesets are still DISABLED. Restore by hand from:" >&2
    echo "   $BACKUP_DIR" >&2
    exit 1
  fi
  rm -rf "$BACKUP_DIR"
  echo "All rulesets restored to their original enforcement."
}
trap restore EXIT INT TERM

# --- pick the repo ---------------------------------------------------------
REPO="${1:-}"
if [ -z "$REPO" ]; then
  suggested=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
  if [ -n "$suggested" ]; then
    read -r -p "Repo [$suggested]: " REPO
    REPO="${REPO:-$suggested}"
  else
    read -r -p "Repo (e.g. digitalnsw/agile): " REPO
  fi
fi
[[ "$REPO" == */* ]] || { echo "Expected owner/repo, got '$REPO'" >&2; exit 1; }

BRANCH=$(gh api "repos/$REPO" --jq .default_branch) || {
  echo "Can't read $REPO — wrong name, or no access." >&2; exit 1; }
echo "Repo:   $REPO"
echo "Branch: $BRANCH"

# --- find the rulesets that actually apply to that branch ------------------
# (while-read rather than mapfile: macOS ships bash 3.2)
candidates=()
while IFS= read -r line; do
  [ -n "$line" ] && candidates+=("$line")
done < <(
  gh api "repos/$REPO/rules/branches/$BRANCH" --jq '[.[].ruleset_id] | unique | .[]' 2>/dev/null
)
if [ "${#candidates[@]}" -eq 0 ]; then
  echo "No rulesets apply to $BRANCH — just push normally."; exit 0
fi

mkdir -p "$BACKUP_DIR"
echo
echo "Rulesets applying to $BRANCH:"
for id in "${candidates[@]}"; do
  if gh api "repos/$REPO/rulesets/$id" > "$BACKUP_DIR/$id.json" 2>/dev/null; then
    name=$(jq -r .name "$BACKUP_DIR/$id.json")
    enf=$(jq -r .enforcement "$BACKUP_DIR/$id.json")
    src=$(jq -r '.source_type // "Repository"' "$BACKUP_DIR/$id.json")
    # The repo endpoint RETURNS inherited org rulesets but cannot PUT them —
    # detect by source_type, not by a failed GET.
    if [ "$src" != "Repository" ]; then
      rm -f "$BACKUP_DIR/$id.json"
      echo "  [$id] $name ($src-level) — cannot disable from repo scope, skipping"
      echo "        (org rulesets are changed at orgs/<org>/rulesets and affect EVERY repo)"
      continue
    fi
    if [ "$enf" = "active" ]; then
      IDS+=("$id"); echo "  [$id] $name ($enf) — will disable"
    else
      rm -f "$BACKUP_DIR/$id.json"; echo "  [$id] $name ($enf) — already inactive, leaving alone"
    fi
  else
    rm -f "$BACKUP_DIR/$id.json"
    echo "  [$id] org-level or no admin access — CANNOT disable, may still block" >&2
  fi
done

if [ "${#IDS[@]}" -eq 0 ]; then
  echo; echo "Nothing to disable."; exit 0
fi

echo
echo "Backups: $BACKUP_DIR"
read -r -p "Disable ${#IDS[@]} ruleset(s) on $REPO:$BRANCH? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# --- disable ---------------------------------------------------------------
for id in "${IDS[@]}"; do
  jq '{name, target, enforcement: "disabled", conditions, rules, bypass_actors}' \
    "$BACKUP_DIR/$id.json" \
    | gh api -X PUT "repos/$REPO/rulesets/$id" --input - >/dev/null || {
      echo "Failed to disable ruleset $id — aborting." >&2; exit 1; }
  echo "  disabled $id"
done

# --- push ------------------------------------------------------------------
echo
here=$(git rev-parse --show-toplevel 2>/dev/null || true)
here_repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
if [ -n "$here" ] && [ "$here_repo" = "$REPO" ]; then
  echo "Pushing $BRANCH from $here …"
  git push origin "$BRANCH" || echo "!! push failed — restoring anyway" >&2
else
  echo "Protection is OFF. Push now from your clone, then press Enter."
  echo "(auto-restoring in 5 minutes if you don't)"
  read -r -t 300 _ || echo "  timed out"
fi

# restore runs via the EXIT trap
