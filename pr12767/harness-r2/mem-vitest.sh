#!/bin/bash
# Real vitest runs of the PR's store test file; records the 100 MiB test's
# arrayBuffers delta via O1B_METRICS_PATH. Usage: mem-vitest.sh <label> <runs> [fnm-node]
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/243daeef-ad6b-41e2-8a6a-0aa4699457fc/scratchpad/h2
cd /Users/wenshao/git/qwen-code-pr12767-h2/packages/core
for i in $(seq 1 "$2"); do
  m="$S/out/metrics-$1-$i.json"; rm -f "$m"
  if [ -n "$3" ]; then runner=(fnm exec --using="$3"); else runner=(); fi
  O1B_METRICS_PATH="$m" NODE_OPTIONS=--max-old-space-size=3072 "${runner[@]}" npx vitest run src/managed-runtime/local-managed-tool-result-store.test.ts --coverage.enabled=false > "$S/out/vitest-$1-$i.log" 2>&1
  code=$?
  node -e 'const fs=require("fs");const m=process.argv[1];let d="n/a";try{const j=JSON.parse(fs.readFileSync(m,"utf8"));d=((j.peakBuffers-j.initialBuffers)/1048576).toFixed(1)}catch{};const log=fs.readFileSync(process.argv[2],"utf8");const t=(log.match(/Tests\s+(.*)/)||[])[1]||"";console.log(process.argv[3],"exit="+process.argv[4],"deltaMiB="+d,t.trim())' "$m" "$S/out/vitest-$1-$i.log" "$1#$i" "$code"
done
