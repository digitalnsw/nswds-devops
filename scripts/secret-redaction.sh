# shellcheck shell=bash
# shellcheck disable=SC2034  # SENSITIVE_REGEX is consumed by the sourcing scripts
# Shared secret detection + redaction for text sent to the AI Gateway.
# Source this file to get a single, consistent implementation across every
# script in this repo (same pattern as openai-config.sh). Keeping one copy
# means a fix here can't silently drift from a second hand-maintained copy.
#
# redact_sensitive_diff operates on ARBITRARY text, not only unified diffs:
# callers also pass it change metadata (branch names, commit subjects, file
# lists) before those reach a prompt.

# Pattern used to *detect* (not redact) potentially sensitive content, so the
# user can be warned before any text leaves the machine. Deliberately broad.
#
# The key/value words match a COMPOUND key that contains the word, not only the
# bare word, so AWS_SECRET_ACCESS_KEY, CLIENT_SECRET and GITHUB_TOKEN trip the
# warning as well as `secret=`. A letter PREFIX is allowed (clientSecret,
# AWS_SECRET_…) but the word may only be followed by `_`/`-`-delimited segments,
# never bare letters — so code identifiers like `tokenizer` or `secretSauce`
# don't trip it. Every caller greps this with `-i`, so the lowercase spellings
# match any case; keep it that way (git-commit.sh, suggest-branch-name.sh).
SENSITIVE_REGEX='(-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{10,}|gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|[a-z0-9_-]*(password|passwd|pwd|secret|token|api[_-]?key|authorization|credentials?|private[_-]?key|passphrase)([_-][a-z0-9]+)*[[:space:]]*[:=])'

# Best-effort redaction of common secret patterns before sending text to the
# API. Takes the text as $1 and prints the redacted version on stdout.
redact_sensitive_diff() {
  local input="$1"
  local redacted="$input"

  # High-signal tokens/keys.
  redacted="$(printf '%s' "$redacted" | sed -E \
    -e 's/AKIA[0-9A-Z]{16}/[REDACTED_AWS_KEY]/g' \
    -e 's/ASIA[0-9A-Z]{16}/[REDACTED_AWS_KEY]/g' \
    -e 's/xox[baprs]-[0-9A-Za-z-]{10,}/[REDACTED_SLACK_TOKEN]/g' \
    -e 's/gh[pousr]_[0-9A-Za-z]{20,}/[REDACTED_GITHUB_TOKEN]/g' \
    -e 's/github_pat_[0-9A-Za-z_]{20,}/[REDACTED_GITHUB_TOKEN]/g' \
  )"

  # Private key blocks: redact the entire block. The BEGIN/END class is broad on
  # purpose — [A-Z0-9 ]*PRIVATE KEY[A-Z ]* covers plain, RSA, OPENSSH, EC, DSA,
  # ENCRYPTED and "PGP … BLOCK" markers (and any future variant) rather than
  # enumerating algorithms, which is what let ENCRYPTED/PGP blocks slip through.
  # A complete BEGIN…END pair on the SAME line (a GCP service-account JSON stores
  # the key as one line with `\n` escapes) is redacted in place and does NOT
  # enter block mode — otherwise `next` swallows every following line until an
  # unrelated END appears, silently truncating the diff. redact_inline_pairs
  # walks the pairs left to right, matching each up to the FIRST END after its
  # BEGIN, so content between two independent pairs on one line survives (a single
  # greedy `.*` would collapse from the first BEGIN to the last END). The inline
  # path only fires on the ordered BEGIN…END pattern (not BEGIN and END
  # independently): a line where an END precedes a BEGIN falls through to the
  # block-open rule so the block the trailing BEGIN opens is still redacted. If a
  # lone BEGIN with no END is left on the line after the inline pairs are
  # redacted, it opens a real multi-line block, so enter block mode there.
  #
  # Block state is handled FIRST: while inside an open block every line is
  # suppressed, and the block closes only on an END with no BEGIN — so a
  # marker-bearing body line (adversarial or malformed input carrying an inline
  # BEGIN…END while a block is open) is dropped whole rather than routed through
  # the inline path, which would print the text surrounding the pair and leak
  # block-body content. The trailing sed catches any orphan BEGIN/END markers
  # that weren't part of a complete block.
  #
  # ── State machine (awk rules run top-to-bottom per line; first `next` wins) ──
  # Two states: OUT (in_private_key unset) and IN (a multi-line block is open).
  #
  #   Rule 1  IN only   suppress every line; close on the FIRST END that has no
  #                     BEGIN before it, keep the suffix after that END and fall
  #                     through (a BEGIN before that END = nested → stay IN).
  #   Rule 2  OUT       a complete ordered BEGIN…END pair on the line: redact each
  #                     pair in place (redact_inline_pairs), preserving text
  #                     around/between pairs; a lone BEGIN left over → go IN.
  #   Rule 3  OUT       a lone BEGIN with no closing END: go IN, preserving any
  #                     text before the marker.
  #   Rule 4            default: print the line unchanged.
  #
  # Invariants to preserve when editing:
  #   • IN never prints block-body content; only a clean END (no BEGIN before it
  #     on the line) closes the block.
  #   • Text before a BEGIN and after a closing END (the "suffix") is kept and
  #     re-run through the later rules and the key/value sed, so a secret there
  #     is still masked — preserving it never leaks.
  #   • When marker structure is ambiguous (nested/stacked BEGINs, a BEGIN before
  #     the END), err toward staying IN / suppressing rather than emitting — the
  #     whole file prefers over-redaction to a leak.
  #   • Rule 1 must stay FIRST: routing an in-block line through Rule 2 would
  #     print the text around an inline pair and leak block-body content.
  redacted="$(printf '%s' "$redacted" | awk '
    function redact_inline_pairs(s,   out, bstart, blen, rest, ep, el) {
      out = "";
      while (match(s, /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/)) {
        bstart = RSTART; blen = RLENGTH;
        rest = substr(s, bstart + blen);
        if (match(rest, /-----END [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/)) {
          ep = RSTART; el = RLENGTH;
          # A second BEGIN before the selected END means the markers are nested
          # or stacked, so this END does not close THIS BEGIN. Stop and leave the
          # outer BEGIN in the residual, so the caller opens block mode and
          # suppresses the rest of the line — otherwise the outer body between the
          # inner END and the outer END (e.g. BEGIN…BEGIN…END…secret…END) leaks.
          if (substr(rest, 1, ep - 1) ~ /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/) {
            break;
          }
          out = out substr(s, 1, bstart - 1) "[REDACTED_PRIVATE_KEY_BLOCK]";
          s = substr(rest, ep + el);
        } else {
          break;
        }
      }
      return out s;
    }
    in_private_key {
      if (match($0, /-----END [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/) && substr($0, 1, RSTART - 1) !~ /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/) {
        # The FIRST END with no BEGIN before it closes the block: drop the body
        # and everything up to and including that END, but keep any legitimate
        # suffix after it (a multi-line PEM inside JSON whose last line is
        # `…END-----","f":"v"`, or a line that also starts the next block). A
        # BEGIN *before* the first END means nested/stacked markers, so this END
        # is not ours and the line stays suppressed. The suffix may itself open a
        # new block or carry a secret, so fall through and let the rules below
        # (and the key/value sed) handle it. `substr(... RSTART-1)` reads before
        # the END match; `~` does not disturb RSTART/RLENGTH, so they still point
        # at that END for the substr below.
        in_private_key = 0;
        $0 = substr($0, RSTART + RLENGTH);
        if ($0 == "") next;
      } else {
        next;
      }
    }
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----.*-----END [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/ {
      $0 = redact_inline_pairs($0);
      if (match($0, /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/)) {
        printf "%s[REDACTED_PRIVATE_KEY_BLOCK]\n", substr($0, 1, RSTART - 1);
        in_private_key = 1;
        next;
      }
      print;
      next;
    }
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/ {
      # A lone BEGIN opens a multi-line block. Keep any legitimate text before
      # the marker (e.g. metadata that precedes an inline key on the same line),
      # replacing only from the BEGIN onward.
      match($0, /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/);
      printf "%s[REDACTED_PRIVATE_KEY_BLOCK]\n", substr($0, 1, RSTART - 1);
      in_private_key = 1;
      next;
    }
    { print; }
  ' | sed -E \
    -e 's/-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/[REDACTED_PRIVATE_KEY]/g' \
    -e 's/-----END [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/[REDACTED_PRIVATE_KEY_END]/g' \
  )"

  # Common "key/value" secrets (env/ini/yaml/json), best-effort broad.
  #
  # The key is matched as a run of [A-Za-z0-9_-] that CONTAINS one of the
  # sensitive words, so compound names (AWS_SECRET_ACCESS_KEY, CLIENT_SECRET,
  # GITHUB_TOKEN, X_API_KEY, clientSecret) are redacted, not only the bare word.
  # A letter PREFIX is allowed, but the word may be followed only by
  # `_`/`-`-delimited segments (`suf`), never bare letters — so code identifiers
  # like `tokenizer = …` or `secretSauce = …` are left intact rather than having
  # their right-hand side redacted across a whole diff. The same rule requires a
  # `:`/`=` after the key, so the `pwd` shell builtin (`$(pwd)`, `pwd)`) is not
  # touched even though `pwd` is now a matched word. Case is handled with
  # explicit classes because BSD/macOS sed has no /I flag. A double-quoted value
  # (JSON or YAML) is masked in place as "[REDACTED]" for clean output; its class
  # consumes escaped characters as units (`\\.`), so a `\"` inside the value does
  # not end the match early and leak the rest. Any other value — unquoted,
  # single-quoted, backtick, multi-word, or containing '#' — is
  # masked to end of line, so a passphrase or a single-quoted secret can't
  # survive by hiding behind a space or a '#'. Over-redacting an innocuous
  # "*_token"/"*_secret" key (or a matched key's multi-token RHS in code) is
  # deliberate: it errs toward hiding a value rather than leaking one.
  local word='([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss][Ww][Dd]|[Pp][Ww][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll][Ss]?|[Pp][Rr][Ii][Vv][Aa][Tt][Ee][_-]?[Kk][Ee][Yy]|[Pp][Aa][Ss][Ss][Pp][Hh][Rr][Aa][Ss][Ee])'
  local suf='([_-][A-Za-z0-9]+)*'
  # Authorization is handled separately from `word`: its value is a scheme plus
  # a credential (Bearer/Basic/…), or occasionally no scheme, so the whole value
  # is redacted rather than the first token — otherwise a plain key/value rule
  # would mask "Bearer" and leave the credential. Covers bare, all-caps and
  # compound keys (HTTP_AUTHORIZATION), quoted or not; the ${suf} rule still
  # excludes camelCase identifiers like `authorizationHeader = …`.
  local auth='[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]'
  printf '%s' "$redacted" | sed -E \
    -e "s/(\"[A-Za-z0-9_-]*${word}${suf}\"[[:space:]]*:[[:space:]]*\")(\\\\.|[^\"\\\\])*\"/\1[REDACTED]\"/g" \
    -e "s/([A-Za-z0-9_-]*${word}${suf}[[:space:]]*[:=][[:space:]]*\")(\\\\.|[^\"\\\\])*\"/\1[REDACTED]\"/g" \
    -e "s/([A-Za-z0-9_-]*${word}${suf}[[:space:]]*[:=][[:space:]]*)[^[:space:]\"].*/\1[REDACTED]/g" \
    -e "s/(\"?[A-Za-z0-9_-]*${auth}${suf}\"?[[:space:]]*[:=][[:space:]]*\")(\\\\.|[^\"\\\\])*\"/\1[REDACTED]\"/g" \
    -e "s/([A-Za-z0-9_-]*${auth}${suf}[[:space:]]*[:=][[:space:]]*)[^[:space:]\"].*/\1[REDACTED]/g"
}
