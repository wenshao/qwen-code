#!/bin/bash
# usage: run-arm.sh <arm> <repeat> <test files...>   (run from repo root; writes probe-out/<arm>-<i>.txt)
set -u
ARM=$1; N=$2; shift 2
mkdir -p probe-out
for i in $(seq 1 "$N"); do
  OUT="probe-out/${ARM}-${i}.txt"
  START=$(date +%s)
  (cd packages/cli && npx vitest run "$@" --reporter=verbose) > "$OUT" 2>&1
  RC=$?
  END=$(date +%s)
  TESTS=$(grep -E '^ +Tests +' "$OUT" | tail -1 | sed -E 's/^ +Tests +//')
  IGN=$(grep -c 'ignore-abort' "$OUT")
  IGN_OK=$(grep -E '✓.*\(ignore-abort\)' "$OUT" | head -1 | sed -E 's/^ +//')
  echo "PROBE_JSON {\"arm\":\"${ARM}\",\"i\":${i},\"exit\":${RC},\"secs\":$((END-START)),\"tests\":\"${TESTS}\",\"ignoreAbortLines\":${IGN},\"ignoreAbort\":\"${IGN_OK//\"/}\"}"
  grep -E '(✗|×|FAIL)' "$OUT" | head -20
done
