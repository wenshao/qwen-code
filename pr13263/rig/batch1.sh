#!/bin/bash
R=/Users/wenshao/git/pr13263-rig
KEEP_TMP=1 $R/run-one.sh base-obs-qwen38max base-obs --model qwen3.8-max
for i in 2 3 4 5; do $R/run-one.sh head-qwen38max-r$i head --model qwen3.8-max; done
$R/run-one.sh obs-qwen38max obs --model qwen3.8-max
for i in 1 2 3; do $R/run-one.sh head-kimik3-r$i head --model kimi-k3; done
for i in 1 2; do $R/run-one.sh head-glm53-r$i head --model glm-5.3; done
for i in 1 2; do $R/run-one.sh head-dsv41flash-r$i head --model deepseek-v4.1-flash; done
for i in 1 2; do $R/run-one.sh head-qwen38flash-r$i head --model qwen3.8-flash; done
$R/run-one.sh head-delay20s head --model qwen3.8-max --runtime-delay-ms 20000
$R/run-one.sh head-delay45s head --model qwen3.8-max --runtime-delay-ms 45000
for m in m1-no-session-store m2-no-broker-flags m3-no-actor-header m3b-poll-no-actor m4-absolute-path m5-require-tool-event a1-write-twice a2-list-first; do
  KEEP_TMP=1 $R/run-one.sh $m $m --model qwen3.8-max
done
for i in 1 2; do $R/run-one.sh head-session-failover-r$i head --session-failover; done
for i in 1 2; do $R/run-one.sh base-session-failover-r$i base --session-failover; done
for i in 2 3; do $R/run-one.sh base-qwen38max-r$i base --model qwen3.8-max; done
MYSQL_BIN=/opt/homebrew/bin NODE_BIN=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin JAVA_BIN=/Users/wenshao/Install/jdk26/bin $R/run-one.sh head-authorenv-qwen38max head --model qwen3.8-max
echo BATCH1_DONE
