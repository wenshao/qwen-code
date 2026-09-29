#!/bin/bash
D=$(dirname "$0")
gh run list --repo QwenLM/qwen-code --workflow sdk-java.yml --limit 400 --json databaseId,headSha,event,createdAt,headBranch,conclusion,status > $D/runs.json
node -e '
const r=require(process.argv[1]);
const c={};for(const x of r){c[x.conclusion||x.status]=(c[x.conclusion||x.status]||0)+1}
console.log("total",r.length,JSON.stringify(c),"oldest",r[r.length-1].createdAt,"newest",r[0].createdAt);
require("fs").writeFileSync(process.argv[2], r.filter(x=>x.conclusion==="failure").map(x=>x.databaseId).join("\n")+"\n");
' $D/runs.json $D/failed-ids.txt
while read id; do
  [ -z "$id" ] && continue
  [ -s $D/logs/$id.log ] && continue
  gh run view $id --repo QwenLM/qwen-code --log-failed > $D/logs/$id.log 2>/dev/null || echo "fetch-fail $id" >> $D/errors.txt
done < $D/failed-ids.txt
echo DONE > $D/done.txt
