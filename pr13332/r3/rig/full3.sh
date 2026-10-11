#!/bin/bash
# Round 3: whole core / cli suites for one arm (JSON results), default timeouts.
# usage: full3.sh <arm> <core|cli>...
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/6e71d8f5-1773-47a3-9ac8-2a5067bb20d2/scratchpad/pr13332/r3
export PATH="/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH"
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
A=$1; shift
for P in "$@"; do
  W=/Users/wenshao/git/pr13332-$A/packages/$P
  t0=$(date +%s)
  T=$S/tmp-$P-$A; rm -rf "$T"; mkdir -p "$T"
  (cd $W && TMPDIR=$T/ npx vitest run --coverage.enabled=false --reporter=json --outputFile=$S/full-$P-$A.json > $S/full-$P-$A.log 2>&1)
  code=$?
  homes=$(find "$T" -maxdepth 1 -name 'qwen-cli-test-home-*' | wc -l | tr -d ' ')
  printf 'FULL\t%s\t%s\texit=%s\t%ss\thomes=%s\tload=%s\n' "$A" "$P" "$code" $(( $(date +%s)-t0 )) "$homes" "$(sysctl -n vm.loadavg)" | tee -a $S/full3.tsv
done
