#!/usr/bin/env bash
# Runs each named mutant against the PR's own changed test files.
set -uo pipefail
T=/root/git/wt10347
OUT=/root/git/h10347/out/mutation
mkdir -p "$OUT"
: > "$OUT/table.txt"
for M in M1 M2 M3 M4 M5; do
  git -C "$T" checkout -- packages/core/src/utils/retryErrorClassification.ts packages/core/src/core/llm-chat.ts
  python3 /root/git/h10347/mutate.py "$M" > "$OUT/$M.apply" 2>&1 || { echo "$M APPLY-FAILED" >> "$OUT/table.txt"; continue; }
  ( cd "$T" && npx vitest run packages/core/src/utils/retryErrorClassification.test.ts packages/core/src/core/llm-chat.test.ts ) > "$OUT/$M.log" 2>&1
  RC=$?
  FAILED=$(grep -oE "Tests +[0-9]+ failed" "$OUT/$M.log" | head -1)
  if [ $RC -ne 0 ]; then STATUS="KILLED"; else STATUS="SURVIVED"; fi
  NAMES=$(grep -E "^\s+×" "$OUT/$M.log" | sed 's/^ *//' | head -4 | tr '\n' ';')
  echo "$M $STATUS ${FAILED:-(all passed)} :: $NAMES" >> "$OUT/table.txt"
  echo "$M -> $STATUS"
done
git -C "$T" checkout -- packages/core/src/utils/retryErrorClassification.ts packages/core/src/core/llm-chat.ts
git -C "$T" status --short
cat "$OUT/table.txt"
