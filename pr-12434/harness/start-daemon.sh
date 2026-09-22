#!/bin/bash
# usage: start-daemon.sh <run-name> <daemonPort> <fakePort> [--fresh]
NAME=$1; DP=$2; FP=$3; FRESH=$4
R=/root/verify/pr12434-harness; RUN=$R/run-$NAME
if [ "$FRESH" = "--fresh" ]; then
  rm -rf $RUN; mkdir -p $RUN/home $RUN/ws/notes
  cd $RUN/ws && git init -q && echo "# trajectory ws" > README.md
  for i in $(seq 0 19); do printf 'note %s\nline two of note %s\n' $i $i > notes/note-$i.txt; done
  git add . && git -c user.email=a@b -c user.name=n commit -qm init
  echo '{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"fake-model"},"tools":{"approvalMode":"yolo"}}' > $RUN/home/settings.json
fi
cd /root/verify/pr12434-head
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy
export QWEN_HOME=$RUN/home OPENAI_BASE_URL=http://127.0.0.1:$FP/v1 OPENAI_API_KEY=dummy OPENAI_MODEL=fake-model QWEN_SANDBOX=false
exec node ${DIST:-dist}/cli.js serve --port $DP --token tok-12434 --workspace $RUN/ws >> $RUN/daemon.log 2>&1
