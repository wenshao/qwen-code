#!/bin/bash
# usage: start-arm.sh <arm: head|base> <daemonPort> <fakePort> <vendorPort> [extra-settings-json]
ARM=$1; DP=$2; FP=$3; VP=$4; EXTRA=${5:-'{}'}
R=/root/verify/pr12258-r2; H=$R/harness; RUN=$R/run-${RUNNAME:-$ARM}
if [ -n "$KEEP" ]; then cd $R/$ARM; unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy; export QWEN_HOME=$RUN/home OPENAI_BASE_URL=http://127.0.0.1:$FP/v1 OPENAI_API_KEY=dummy OPENAI_MODEL=fake-model QWEN_SANDBOX=false QWEN_DEBUG_LOG_FILE=1; exec node dist/cli.js serve --port $DP --token tok-$ARM --workspace $RUN/ws >> $RUN/daemon.log 2>&1; fi
rm -rf $RUN; mkdir -p $RUN/home $RUN/ws
cd $RUN/ws && git init -q && echo "# ws" > README.md && git add . && git -c user.email=a@b -c user.name=n commit -qm init
NM=$R/$ARM/node_modules
node -e '
const [H,RUN,DP,VP,NM,EXTRA]=process.argv.slice(1);
const srv=(tag,extra={})=>({command:"node",args:[H+"/fixture-app-server.mjs","--log",RUN+"/mcp-calls.jsonl","--vendor","http://127.0.0.1:"+VP,"--daemon","http://127.0.0.1:"+DP,"--tag",tag,"--secret","SECRET-"+tag.toUpperCase()],env:{FIXTURE_NODE_MODULES:NM},alwaysLoadTools:true,...extra});
const s={security:{auth:{selectedType:"openai"}},model:{name:"fake-model"},tools:{approvalMode:"default"},
 mcpServers:{fixture:srv("fixture"),other:srv("other")}};
const e=JSON.parse(EXTRA); if(e.settings) Object.assign(s,e.settings); for(const [k,v] of Object.entries(e.mcpServers||{})){const b=s.mcpServers[k]||srv(k); if(v.pad){b.args.push("--pad",String(v.pad)); delete v.pad;} s.mcpServers[k]={...b,...v};} if(e.excludeTools) s.tools.exclude=e.excludeTools;
require("fs").writeFileSync(RUN+"/home/settings.json",JSON.stringify(s,null,1));
' $H $RUN $DP $VP $NM "$EXTRA"
cd $R/$ARM
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy
export QWEN_HOME=$RUN/home OPENAI_BASE_URL=http://127.0.0.1:$FP/v1 OPENAI_API_KEY=dummy OPENAI_MODEL=fake-model QWEN_SANDBOX=false QWEN_DEBUG_LOG_FILE=1
exec node dist/cli.js serve --port $DP --token tok-$ARM --workspace $RUN/ws >> $RUN/daemon.log 2>&1
