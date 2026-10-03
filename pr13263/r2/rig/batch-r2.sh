#!/bin/bash
R=/Users/wenshao/git/pr13263-rig
M=qwen3.8-max
O=$R/run-one-r2.sh
for i in 01 02 03 04 05 06 07 08 09 10; do $O head-r$i head --model $M; done
for i in 01 02 03 04 05 06 07 08 09 10; do KEEP_TMP=1 $O obs-r$i obs --model $M; done
for i in 1 2; do KEEP_TMP=1 $O a2obs-r$i a2obs --model $M; done
for i in 1 2 3; do $O head-session-failover-r$i head --session-failover; done
$O base-session-failover base --session-failover
$O base-realmodel base --model $M
$O head-delay20s head --model $M --runtime-delay-ms 20000
$O head-delay45s head --model $M --runtime-delay-ms 45000
for i in 1 2; do $R/with-jar.sh $R/jars/tenant-leak-mutant.jar $O leakjar-head-r$i head --model $M; done
for i in 1 2; do $R/with-jar.sh $R/jars/tenant-leak-mutant.jar $O leakjar-r1runner-r$i r1 --model $M; done
MYSQL_BIN=/opt/homebrew/bin NODE_BIN=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin JAVA_BIN=/Users/wenshao/Install/jdk26/bin $O head-authorenv head --model $M
echo BATCH_R2_DONE
