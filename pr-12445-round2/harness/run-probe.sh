#!/bin/bash
# usage: run-probe.sh <head|fix> <MainClass> [args...]   (JAVA_OPTS env passes -D flags)
H=/root/verify/pr12458-harness; M2=/root/.m2/repository; ARM=$1; shift; MAIN=$1; shift
CP=/h/copies/$ARM/runtime-broker/target/classes:/h/copies/$ARM/runtime-broker/target/test-classes:$M2/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar:$M2/com/h2database/h2/2.3.232/h2-2.3.232.jar:$M2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar
docker run --rm --network host -v /root/.m2:/root/.m2 -v $H:/h -w /h eclipse-temurin:21-jdk bash -c "mkdir -p probes/out-$ARM && javac -nowarn --release 21 -cp $CP -d probes/out-$ARM probes/src/com/alibaba/qwen/code/runtimebroker/*.java 2>&1 | grep -v '^Note:' ; java $JAVA_OPTS -cp probes/out-$ARM:$CP com.alibaba.qwen.code.runtimebroker.$MAIN $*"
