#!/bin/bash
# Host jar (Prerequisites path) against a scratch MySQL with the README's
# documented grants (schema-only), then with the one extra SELECT grant.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8d1d0002-cbf9-486b-a3c9-1d082c3ea9f3/scratchpad
J=/Users/wenshao/Install/jdk21/bin/java
JAR=$S/wt-head/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
L=$(mktemp -d -t p13344lp); echo "rig dir $L"
P=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
SP=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
mysqld --no-defaults --initialize-insecure --datadir=$L/data >/dev/null 2>&1
mysqld --no-defaults --datadir=$L/data --socket=$L/m.sock --port=$P --bind-address=127.0.0.1 --mysqlx=0 --pid-file=$L/m.pid --log-error=$L/err.log & MPID=$!
for i in $(seq 1 60); do mysqladmin --no-defaults -h127.0.0.1 -P$P -uroot ping >/dev/null 2>&1 && break; sleep 1; done
echo "mysqld $(mysqld --version | awk '{print $3}') port=$P pid=$MPID"
# README Prerequisites line, adapted only for the scratch password
mysql --no-defaults -h127.0.0.1 -P$P -uroot -e "CREATE DATABASE qwen_managed_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'qwen'@'localhost' IDENTIFIED BY 'replace-me'; CREATE USER 'qwen'@'127.0.0.1' IDENTIFIED BY 'replace-me'; GRANT ALL ON qwen_managed_agent.* TO 'qwen'@'localhost'; GRANT ALL ON qwen_managed_agent.* TO 'qwen'@'127.0.0.1';"
boot() { # label
  rm -f $L/$1.log
  ( cd $L && env -i PATH=/usr/bin:/bin HOME=$L SERVER_PORT=$SP SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:$P/qwen_managed_agent" SPRING_DATASOURCE_USERNAME=qwen SPRING_DATASOURCE_PASSWORD=replace-me $J -jar $JAR > $L/$1.log 2>&1 ) & JP=$!
  for i in $(seq 1 90); do
    grep -q 'Started ManagedAgentServerApplication' $L/$1.log && { echo "$1: STARTED health=$(curl --noproxy '*' -sS -m 3 http://127.0.0.1:$SP/actuator/health)"; kill $JP; wait $JP 2>/dev/null; return; }
    kill -0 $JP 2>/dev/null || { echo "$1: EXITED -> $(grep -m1 -oE "SELECT command denied[^']*'[^']*'[^']*'[^']*'" $L/$1.log) | $(grep -m1 -oE "Unable to determine value for 'foreign_key_checks' variable" $L/$1.log) | $(grep -m1 -c 'discard' $L/$1.log) druid discard line(s)"; return; }
    sleep 1
  done; echo "$1: TIMEOUT"; kill $JP
}
boot documented-grants
mysql --no-defaults -h127.0.0.1 -P$P -uroot -e "GRANT SELECT ON performance_schema.user_variables_by_thread TO 'qwen'@'127.0.0.1';"
mysql --no-defaults -h127.0.0.1 -P$P -uroot -e "DROP DATABASE qwen_managed_agent; CREATE DATABASE qwen_managed_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
boot plus-perf-schema-select
kill $MPID; wait $MPID 2>/dev/null; echo done
