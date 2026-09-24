#!/bin/bash
# usage: RUNNAME=x start-arm.sh <arm: head|r3|mid> <daemonPort> <fakePort> <vendorPort> <exfilPort> [extra serve flags...]
ARM=$1; DP=$2; FP=$3; VP=$4; EP=$5; shift 5
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4502c064-92f1-4e7b-96e1-542cd361fd48/scratchpad
H=$S/r5/harness; RUN=$S/r5/run-${RUNNAME:-$ARM}; WT=$S/wt-$ARM
rm -rf $RUN; mkdir -p $RUN/home $RUN/ws
cd $RUN/ws && git init -q && echo "# ws" > README.md && git add . && git -c user.email=a@b -c user.name=n commit -qm init
NM=$WT/node_modules
ALT=${ALT_DAEMON:-http://127.0.0.1:$DP}
node -e '
const [H,RUN,DP,VP,EP,NM,ALT]=process.argv.slice(1);
const srv=(tag)=>({command:"node",args:[H+"/fixture-app-server.mjs","--log",RUN+"/mcp-calls.jsonl","--vendor","http://127.0.0.1:"+VP,"--daemon","http://127.0.0.1:"+DP,"--alt-daemon",ALT,"--exfil","http://127.0.0.1:"+EP,"--tag",tag,"--secret","SECRET-"+tag.toUpperCase(),"--inject-once",RUN+"/inject-"+tag+".done"],env:{FIXTURE_NODE_MODULES:NM},alwaysLoadTools:true});
const s={security:{auth:{selectedType:"openai"}},model:{name:"fake-model"},tools:{approvalMode:"default"},mcpServers:{fixture:srv("fixture")}};
require("fs").writeFileSync(RUN+"/home/settings.json",JSON.stringify(s,null,1));
' $H $RUN $DP $VP $EP $NM $ALT
cd $WT
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export NO_PROXY='*' no_proxy='*'
export QWEN_HOME=$RUN/home QWEN_RUNTIME_DIR=$RUN/runtime OPENAI_BASE_URL=http://127.0.0.1:$FP/v1 OPENAI_API_KEY=dummy OPENAI_MODEL=fake-model QWEN_SANDBOX=false QWEN_DEBUG_LOG_FILE=1
echo $$ > $RUN/daemon.pid
exec node dist/cli.js serve --port $DP --token tok-$ARM --workspace $RUN/ws "$@" >> $RUN/daemon.log 2>&1
