#!/bin/bash
# usage: loop3.sh <arm> <n> <label> <test-file-relative-to-packages/cli>
# Runs one cli test file n times in a fresh vitest each; one TSV row per run.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332/r3
export PATH="/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH"
A=$1; N=$2; L=$3; F=$4
cd /Users/wenshao/git/pr13332-$A/packages/cli || exit 1
[ -f "$F" ] || { echo "missing $F"; exit 2; }
mkdir -p $S/loop
for i in $(seq 1 $N); do
  log=$S/loop/$L-$i.log
  npx vitest run "$F" --coverage.enabled=false --reporter=verbose > $log 2>&1; code=$?
  case=$(grep -cE "✓.*settles a cascade driven only by a hasMeasured transition|✓ .*hasMeasured transition" $log)
  sig=$(grep -oE "expected '' to contain 'fallback'|Maximum update depth exceeded|#185" $log | head -1)
  printf '%s\t%s\t%s\texit=%s\tcasepass=%s\t%s\tload=%s\n' "$L" "$i" "$A" "$code" "$case" "${sig:--}" "$(sysctl -n vm.loadavg | awk '{print $2}')" >> $S/loop3.tsv
done
echo "LOOP_DONE $L"
