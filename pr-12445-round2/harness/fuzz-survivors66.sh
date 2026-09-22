#!/bin/bash
M2=/root/.m2/repository; id=$1
CP=/h/mut66/$id/runtime-broker/target/classes:/h/copies/pr12445/runtime-broker/target/test-classes:$M2/com/alibaba/fastjson2/fastjson2/2.0.60/fastjson2-2.0.60.jar:$M2/com/h2database/h2/2.3.232/h2-2.3.232.jar
mkdir -p /tmp/o-$id && javac -nowarn --release 21 -cp $CP -d /tmp/o-$id /h/probes/src/com/alibaba/qwen/code/runtimebroker/DiffFuzz.java 2>/dev/null
java -cp /tmp/o-$id:$CP com.alibaba.qwen.code.runtimebroker.DiffFuzz h2 1500 60 1000 > /h/mut66/$id/fuzz.log 2>&1
