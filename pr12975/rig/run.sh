#!/bin/bash
# usage: run.sh <arm> <tapPort> <ledger> <args...>
ARM=$1; TAP=$2; export LEDGER=$3; shift 3
B=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/brig
MYSQL=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/m2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar
C=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/dce4d4a1-a7ec-40d6-ba4b-33ae38c1dbd4/scratchpad/wt-$ARM/packages/sdk-java/runtime-broker/target/classes
export RIG=$B ROOT="$B/roots/根目录-🚀"
mkdir -p "$ROOT/服务/api"
exec ~/Install/jdk21/bin/java -Duser.timezone=UTC -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=$TAP -Dhttp.nonProxyHosts= -cp "$B/classes-$ARM:$C:$(cat $B/cp.txt):$MYSQL" com.alibaba.qwen.code.runtimebroker.Rig12975 "$@"
