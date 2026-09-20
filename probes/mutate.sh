#!/bin/bash
#   mutate.sh <arm-dir> <label>
# Applies one mutation, runs the PR-touched qwen-live suites, restores via git.
set -u
ARM="$1"; LABEL="$2"
SP="$(dirname "$0")"
PKG="$ARM/packages/qwen-live"
restore() { (cd "$ARM" && git checkout -- packages/qwen-live/src) ; }
trap restore EXIT
if ! DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 "$SP/mutate.py" "$PKG" "$LABEL"; then
  echo "MUTANT|$LABEL|NOT_APPLICABLE"
  exit 0
fi
SUITES=()
for f in src/proactive/monitor-debug-store.test.ts src/host/discovery.test.ts \
         src/language-preferences.test.ts src/memory/service.test.ts \
         src/private-directory.test.ts; do
  [ -f "$PKG/$f" ] && SUITES+=("$f")
done
OUT="$(cd "$PKG" && node ../../node_modules/vitest/vitest.mjs run "${SUITES[@]}" 2>&1)"
RC=$?
SUMMARY="$(printf '%s\n' "$OUT" | grep -E '^ *Tests +' | tail -1 | sed 's/^ *//')"
NAMES="$(printf '%s\n' "$OUT" | grep -E '^ *× ' | sed 's/^ *× *//' | sed 's/ [0-9]*ms$//' | sort -u | head -10)"
if [ "$RC" -ne 0 ]; then KILLED=KILLED; else KILLED=SURVIVED; fi
echo "MUTANT|$LABEL|$KILLED|${SUMMARY:-no-summary}"
[ -n "$NAMES" ] && printf '%s\n' "$NAMES" | sed 's/^/      /'
exit 0
