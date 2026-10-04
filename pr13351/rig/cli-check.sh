#!/bin/bash
# VERIFICATION RIG ONLY: blast-radius check — the interactive/headless CLI (no Hosted Harness) against the same midstream cut.
# usage: cli-check.sh <arm> <tag>   (uses the arm's fake model)
set -u
. /Users/wenshao/pr13351-rig/rig.env; . $RIG/ports.sh $1; ARM=$1; TAG=$2
C=$RIG/run/cli-$ARM; H=$C/home; mkdir -p $H/.qwen $C/ws
cat > $H/.qwen/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"rig-model"},"telemetry":{"enabled":false},"ui":{"enableFollowupSuggestions":false},
 "modelProviders":{"openai":[{"id":"rig-model","envKey":"OPENAI_API_KEY","baseUrl":"http://127.0.0.1:$MODEL_PORT/v1"}]}}
JSON
echo "{\"$C/ws\":\"TRUST_FOLDER\"}" > $C/trusted.json
ID=cli-$ARM-$TAG
cd $C/ws
env -i PATH="$(dirname $NODE):/usr/bin:/bin" TZ=UTC HOME=$H QWEN_HOME=$H/.qwen QWEN_RUNTIME_DIR=$C/runtime QWEN_CODE_TRUSTED_FOLDERS_PATH=$C/trusted.json \
  OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=http://127.0.0.1:$MODEL_PORT/v1 NO_PROXY=127.0.0.1,localhost \
  $NODE $RIG/dist/$ARM/cli.js -p "MSR id=$ID sc=cut cuts=1 hold=800. Reply with the scripted answer." --output-format text > $C/$TAG.out 2> $C/$TAG.err
echo "exit=$?"
echo "stdout: $(cat $C/$TAG.out | tr '\n' ' ' | cut -c1-300)"
grep "\"id\":\"$ID\"" $RIG/run/$ARM/model-requests.jsonl | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const l of s.trim().split("\n")){const e=JSON.parse(l); if(e.n) console.log(`  attempt=${e.attempt} body=${e.bodySha} msgs=${e.messageCount} roles=${e.roles} continuationShaped=${e.continuationShaped} last=${JSON.stringify(e.lastMessage.slice(0,90))}`); else console.log(`  ${e.event} ${e.how}`)}})'
