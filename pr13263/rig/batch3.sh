#!/bin/bash
# All model-driven runs use qwen3.8-max (per maintainer instruction).
R=/Users/wenshao/git/pr13263-rig
M=qwen3.8-max
$R/run-one.sh head-delay20s head --model $M --runtime-delay-ms 20000
$R/run-one.sh head-delay45s head --model $M --runtime-delay-ms 45000
for m in m1-no-session-store m2-no-broker-flags m3-no-actor-header m3b-poll-no-actor m4-absolute-path m5-require-tool-event a1-write-twice a2-list-first; do
  KEEP_TMP=1 $R/run-one.sh $m $m --model $M
done
for v in base-obs-tap m1-no-session-store-tap m2-no-broker-flags-tap; do KEEP_TMP=1 $R/run-one.sh $v $v --model $M; done
for i in 1 2; do $R/run-one.sh head-session-failover-r$i head --session-failover; done
for i in 1 2; do $R/run-one.sh base-session-failover-r$i base --session-failover; done
for i in 2 3; do $R/run-one.sh base-qwen38max-r$i base --model $M; done
MYSQL_BIN=/opt/homebrew/bin NODE_BIN=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin JAVA_BIN=/Users/wenshao/Install/jdk26/bin $R/run-one.sh head-authorenv-qwen38max head --model $M
for i in 01 02 03 04 05 06 07 08 09 10; do KEEP_TMP=1 $R/run-one.sh obs-qwen38max-rep$i obs --model $M; done
echo BATCH3_DONE
