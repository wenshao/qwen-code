#!/bin/bash
# usage: run-probe.sh <arm-module-dir> <MainClass> [args...]
set -e
MOD=$1; shift; MAIN=$1; shift
H=/root/verify/pr12438-r2-harness
OUT=$H/probes/out-$(basename $(dirname $(dirname $MOD)))-$(basename $MOD)
rm -rf $OUT; mkdir -p $OUT
CP=$MOD/target/classes:/root/.m2/repository/com/h2database/h2/2.3.232/h2-2.3.232.jar:/root/.m2/repository/com/mysql/mysql-connector-j/9.7.0/mysql-connector-j-9.7.0.jar
javac -nowarn --release 21 -d $OUT -cp $CP $H/probes/src/com/alibaba/qwen/code/runtimebroker/*.java 2>&1 | grep -v "^Note:" || true
java $JOPTS -cp $OUT:$CP com.alibaba.qwen.code.runtimebroker.$MAIN "$@"
