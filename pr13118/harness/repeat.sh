#!/bin/bash
# usage: repeat.sh <worktree> <rounds> <label>   runs the PR's worker test file N times, one line per round
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/1123ef1a-b81b-4bc6-9042-45df0824fe93/scratchpad
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH CI=1 NO_COLOR=1
OUT=$SP/results/repeat-$3; mkdir -p $OUT
cd $SP/$1/packages/cli
for i in $(seq 1 $2); do
  L=$(sysctl -n vm.loadavg | awk '{print $2}')
  npx vitest run --reporter=json --outputFile=$OUT/r$i.json src/serve/managed-runtime-provider-worker.test.ts > $OUT/r$i.log 2>&1
  node -e 'const j=require(process.argv[1]);const f=[];let n=0;for(const t of j.testResults)for(const a of t.assertionResults){n++;if(a.status!=="passed")f.push(a.title)};const d=j.testResults.flatMap(t=>t.assertionResults).filter(a=>/nonzero status cursor|unfitted manifest|pending history read|release preparation is waiting|retirement whose first step fails|shell calls inside the Session workspace/.test(a.title)).map(a=>Math.round(a.duration)+"ms");console.log(`round ${process.argv[2]} load=${process.argv[3]} tests=${n} failed=${f.length}${f.length?" :: "+f.join(" | "):""} newTestMs=${d.join(",")}`)' $OUT/r$i.json $i $L
done
