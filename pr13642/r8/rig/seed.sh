#!/bin/bash
# usage: seed.sh <mysql|maria> <dbname> <mode> [args]
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
if [ "$1" = mysql ]; then PORT=33642; else PORT=43642; fi
DB=$2; shift 2
CP=$S/rig/seeder/${SEEDOUT:-out}:$(ls -d $S/rig/${CPDIR:-cp-head}/BOOT-INF/lib/*.jar | tr '\n' ':')
exec /Users/wenshao/Install/jdk21/bin/java -cp "$CP" com.alibaba.qwen.code.runtimebroker.Seeder "$1" "jdbc:mysql://127.0.0.1:$PORT/$DB?allowPublicKeyRetrieval=true&useSSL=false" root pr13642 "${@:2}"
