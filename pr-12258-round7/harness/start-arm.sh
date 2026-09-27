#!/bin/bash
# usage: RUNNAME=x [EXTRA_SERVERS='{"fxdefault":{},"fxshort":{"timeout":5000}}'] start-arm.sh <arm: head|rev> <daemonPort> <fakePort> <vendorPort> <exfilPort> [extra serve flags...]
ARM=$1; DP=$2; FP=$3; VP=$4; EP=$5; shift 5
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/aca33818-ac1e-4286-aafe-a4b2ded6adec/scratchpad
H=$S/r7/harness; RUN=$S/r7/run-${RUNNAME:-$ARM}; WT=$S/wt-$ARM
rm -rf $RUN; mkdir -p $RUN/home $RUN/ws
cd $RUN/ws && git init -q && echo "# ws" > README.md && git add . && git -c user.email=a@b -c user.name=n commit -qm init
NM=$WT/node_modules
ALT=${ALT_DAEMON:-http://127.0.0.1:$DP}
node -e '
const [H,RUN,DP,VP,EP,NM,ALT,EXTRA]=process.argv.slice(1);
const srv=(tag,over={})=>({command:"node",args:[H+"/fixture-app-server.mjs","--log",RUN+"/mcp-calls.jsonl","--vendor","http://127.0.0.1:"+VP,"--daemon","http://127.0.0.1:"+DP,"--alt-daemon",ALT,"--exfil","http://127.0.0.1:"+EP,"--tag",tag,"--secret","SECRET-"+tag.toUpperCase(),"--inject-once",RUN+"/inject-"+tag+".done","--slow-ms",String(process.env.SLOW_MS||12000)],env:{FIXTURE_NODE_MODULES:NM},alwaysLoadTools:true,...over});
const servers={fixture:srv("fixture")};
for (const [k,v] of Object.entries(JSON.parse(EXTRA||"{}"))) servers[k]=srv(k,v);
const s={security:{auth:{selectedType:"openai"}},model:{name:"fake-model"},tools:{approvalMode:"default"},mcpServers:servers};
require("fs").writeFileSync(RUN+"/home/settings.json",JSON.stringify(s,null,1));
' $H $RUN $DP $VP $EP $NM $ALT "${EXTRA_SERVERS:-}"
cd $WT
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export NO_PROXY='*' no_proxy='*'
export QWEN_HOME=$RUN/home QWEN_RUNTIME_DIR=$RUN/runtime OPENAI_BASE_URL=http://127.0.0.1:$FP/v1 OPENAI_API_KEY=dummy OPENAI_MODEL=fake-model QWEN_SANDBOX=false QWEN_DEBUG_LOG_FILE=1
echo $$ > $RUN/daemon.pid
exec node dist/cli.js serve --port $DP --token tok-$ARM --workspace $RUN/ws "$@" >> $RUN/daemon.log 2>&1
