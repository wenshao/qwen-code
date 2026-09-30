#!/bin/bash
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/1123ef1a-b81b-4bc6-9042-45df0824fe93/scratchpad
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH CI=1 NO_COLOR=1
cd $SP/wt-pr/packages/cli
for seed in 11 23 37 51 79; do
  npx vitest run --sequence.shuffle --sequence.seed=$seed --reporter=json --outputFile=$SP/results/shuffle/s$seed.json src/serve/managed-runtime-provider-worker.test.ts > $SP/results/shuffle/s$seed.log 2>&1
  node -e 'const j=require(process.argv[1]);const all=j.testResults.flatMap(t=>t.assertionResults);const f=all.filter(a=>a.status!=="passed");const order=all.map(a=>a.title);const idx=order.findIndex(t=>/nonzero status cursor/.test(t));console.log(`seed ${process.argv[2]} tests=${all.length} failed=${f.length}${f.length?" :: "+f.map(a=>a.title).join(" | "):""} cursorTestPosition=${idx+1}`)' $SP/results/shuffle/s$seed.json $seed
done
