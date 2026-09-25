#!/bin/bash
set -u
cd "$(dirname "$0")"
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH
CP=$(cat cp.txt); CLI=$HOME/git/qwen-code-pr12712/dist/cli.js; NODE=$(which node); SPR=$(pwd)
R() { java -cp out:$CP com.alibaba.qwen.code.runtimebroker.Rig "$@"; }
R "v1-boot (control)" ws "$NODE" "$CLI" managed-runtime-worker
R "v1-worker + boot-v2" ws sh -c "cat >/dev/null; exec '$NODE' '$CLI' managed-runtime-worker < '$SPR/boot-v2.json'"
R "crash (exit 1)" ws sh -c 'cat >/dev/null; exit 1'
R "crash (SIGKILL)" ws sh -c 'cat >/dev/null; kill -9 $$'
