#!/usr/bin/env bash
# Publish docs/best-practices/*.md to Confluence — one page per guide, under
# GDS → Application Support → Development Best Practice. Runs from CI
# (.github/workflows/confluence-sync.yml); needs `mark` on PATH plus
# MARK_BASE_URL / MARK_USERNAME / MARK_PASSWORD in the environment.
#
# The guides stay plain GitHub markdown: everything Confluence-specific
# (metadata headers, the "synced from GitHub" banner, link rewriting) is
# applied to temp copies here, never to the source files.
set -euo pipefail

DOCS_DIR="docs/best-practices"
SPACE_KEY="GDS"
# Ancestry of the target folder. mark matches folders by TITLE, not ID —
# renaming either folder in Confluence breaks the sync (see MAINTENANCE.md).
FOLDER_CHAIN=("Application Support" "Development Best Practice")
REPO_BLOB_URL="https://github.com/digitalnsw/nswds-devops/blob/main"

# Page title = the guide's H1, so retitling a guide in the repo creates a
# fresh Confluence page and orphans the old one (delete it by hand).
title_for() {
  sed -n 's/^# //p' "$1" | head -n 1
}

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

for src in "$DOCS_DIR"/*.md; do
  base=$(basename "$src")
  title=$(title_for "$src")
  if [[ -z "$title" ]]; then
    echo "::error file=${src}::no H1 heading — cannot derive a Confluence page title"
    exit 1
  fi
  out="$WORKDIR/$base"

  {
    printf -- '<!-- Space: %s -->\n' "$SPACE_KEY"
    for folder in "${FOLDER_CHAIN[@]}"; do
      printf -- '<!-- Folder: %s -->\n' "$folder"
    done
    printf -- '<!-- Title: %s -->\n' "$title"
    printf -- '<!-- Include: ac:box\n'
    printf -- '     Icon: true\n'
    printf -- '     Name: info\n'
    printf -- '     Title: Synced from GitHub\n'
    printf -- '     Body: "This page is published automatically from the nswds-devops repository on GitHub. Edits made here in Confluence will be overwritten by the next sync — propose changes with a pull request instead." -->\n'
    printf -- '\n*Source: [docs/best-practices/%s](%s/%s/%s)*\n\n' \
      "$base" "$REPO_BLOB_URL" "$DOCS_DIR" "$base"
  } > "$out"

  # Links that escape the docs folder (../../foo) have no Confluence
  # counterpart — point them at the file on GitHub instead.
  sed -E "s|\]\(\.\./\.\./([^)]+)\)|](${REPO_BLOB_URL}/\1)|g" "$src" >> "$out"

  # Cross-links between guides become Confluence page links (mark's ac:
  # syntax; angle brackets because the titles contain spaces).
  for other in "$DOCS_DIR"/*.md; do
    other_base=$(basename "$other")
    other_title=$(title_for "$other")
    sed "s|](${other_base//./\\.})|](<ac:${other_title//&/\\&}>)|g" \
      "$out" > "$out.tmp" && mv "$out.tmp" "$out"
  done

  echo "Publishing '${title}' from ${base}"
  # --drop-h1: the H1 duplicates the page title. --minor-edit: don't send a
  # watcher notification on every merge (incompatible with Label headers).
  mark --drop-h1 --minor-edit -f "$out"
done
