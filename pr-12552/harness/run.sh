#!/bin/bash
# usage: run.sh <runtime-broker module dir> [java bin]
MOD=${1:-/root/verify/pr12552/packages/sdk-java/runtime-broker}
JAVA=${2:-java}
H=/root/verify/pr12552-harness
CP=$MOD/target/classes:$HOME/.m2/repository/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar
rm -rf $H/out && mkdir -p $H/out
${JAVA%java}javac -d $H/out -cp $CP $(find $H/src -name '*.java') || exit 2
cd $H && $JAVA -cp $H/out:$CP com.alibaba.qwen.code.runtimebroker.${CLS:-RealWorkerE2E} /root/verify/pr12522/dist/cli.js
