#!/bin/bash
# usage: start-daemon.sh <arm:head|base> <run-name> <daemonPort> <fakePort> [--fresh]
ARM=$1; NAME=$2; DP=$3; FP=$4; FRESH=$5
R=/root/verify/pr12466-harness; RUN=$R/run-$NAME
if [ "$FRESH" = "--fresh" ]; then
  rm -rf $RUN; mkdir -p $RUN/home $RUN/ws/src $RUN/ws/notes
  cd $RUN/ws && git init -q
  printf "const greeting = 'hello';\n// TODO: localize the greeting\nexport function greet(name) {\n  return greeting + ', ' + name;\n}\n" > src/app.js
  printf "export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v)); // TODO: tests\n" > src/util.js
  echo "# tool calls workspace" > README.md
  for i in $(seq 0 19); do printf 'note %s\nline two of note %s\n' $i $i > notes/note-$i.txt; done
  git add . && git -c user.email=a@b -c user.name=n commit -qm "init workspace"
  cat > $RUN/home/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"fake-model"},"tools":{"approvalMode":"yolo"},
 "mcpServers":{"inventory":{"command":"node","args":["$R/mcp-server.mjs","inventory"],"trust":true},
               "catalog":{"command":"node","args":["$R/mcp-server.mjs","catalog"],"trust":true,"alwaysLoadTools":true}}}
JSON
fi
cd /root/verify/pr12466-$ARM
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy
export QWEN_HOME=$RUN/home OPENAI_BASE_URL=http://127.0.0.1:$FP/v1 OPENAI_API_KEY=dummy OPENAI_MODEL=fake-model QWEN_SANDBOX=false
exec node dist/cli.js serve --port $DP --token tok-12466 --workspace $RUN/ws >> $RUN/daemon-$ARM.log 2>&1
