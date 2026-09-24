#!/bin/bash
# usage: run.sh <runtime-broker module dir> [scenarios...]
MOD=$1; shift
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9574b81d-84d7-47eb-8973-25c7fe90cb49/scratchpad
CP=$MOD/target/classes:$HOME/.m2/repository/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar
OUT=$(mktemp -d $S/r2/out.XXXX)
javac -nowarn -d $OUT -cp $CP $S/r2/src/*.java 2>&1 | grep -v '^Note' 
cd $S/r2 && java -cp $OUT:$CP com.alibaba.qwen.code.runtimebroker.R2E2E $S/bundle/dist/cli.js $S/r2/workers $MOD/src/test/resources/fake-attestation-worker.mjs "$@" 2>&1 | grep -v '^WARNING'
rm -rf $OUT
