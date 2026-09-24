#!/bin/bash
# usage: run.sh <runtime-broker module dir> [scenarios...]
MOD=$1; shift
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/1a47ae0c-7f3a-4631-a5d3-514e700853b3/scratchpad/r3
CLI=${CLI:-$HOME/git/qwen-12466-base/dist/cli.js}
CP=$MOD/target/classes:$HOME/.m2/repository/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar
OUT=$(mktemp -d $S/out.XXXX)
javac -nowarn -d $OUT -cp $CP $S/src/*.java 2>&1 | grep -v '^Note'
cd $S && java -cp $OUT:$CP com.alibaba.qwen.code.runtimebroker.R3E2E $CLI $S/workers $MOD/src/test/resources/fake-attestation-worker.mjs "$@" 2>&1 | grep -v '^WARNING'
rm -rf $OUT
