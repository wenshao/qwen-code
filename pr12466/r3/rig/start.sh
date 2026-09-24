#!/bin/bash
# usage: start.sh <arm> <worktree> <port>
arm=$1; wt=$2; port=$3; R=/private/var/tmp/pr12466
cd $R/$arm/ws
exec env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 TERM=xterm-256color \
  QWEN_HOME=$R/$arm/home QWEN_RUNTIME_DIR=$R/$arm/runtime FAKE_KEY=sk-fake \
  QWEN_SERVER_TOKEN=tok12466 QWEN_CODE_NO_RELAUNCH=true NO_PROXY='*' \
  node $wt/dist/cli.js serve --port $port --workspace $R/$arm/ws > $R/$arm/daemon.log 2>&1
