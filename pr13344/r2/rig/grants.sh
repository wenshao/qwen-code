#!/bin/bash
# Execute a documented one-time MySQL line verbatim (only the client connection
# is redirected to a scratch server), then boot the host jar as 'qwen'.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8d1d0002-cbf9-486b-a3c9-1d082c3ea9f3/scratchpad
W=$S/r2/wt
J=/Users/wenshao/Install/jdk21/bin/java
JAR=$W/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
extract() { # source -> SQL inside mysql -u root -e "..."
  case "$1" in
    readme) grep -m1 '^mysql -u root -e "CREATE DATABASE qwen_managed_agent' $W/packages/sdk-java/managed-agent-server/README.md | sed -E 's/^mysql -u root -e "(.*)"$/\1/' ;;
    launcher) grep -m1 'one-time DB/user: mysql -u root -e "' $W/scripts/managed-agent-dev.js | sed -E 's/.*mysql -u root -e "(.*)"`,?$/\1/' ;;
  esac
}
for src in readme launcher; do
  SQL=$(extract $src); echo "== $src: ${SQL:0:60}... grants_perf_schema=$(echo "$SQL" | grep -c user_variables_by_thread)"
  L=$(mktemp -d -t p13344g); P=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'); SP=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  mysqld --no-defaults --initialize-insecure --datadir=$L/data >/dev/null 2>&1
  mysqld --no-defaults --datadir=$L/data --socket=$L/m.sock --port=$P --bind-address=127.0.0.1 --mysqlx=0 --pid-file=$L/m.pid --log-error=$L/err.log & MPID=$!
  for i in $(seq 1 60); do mysqladmin --no-defaults -h127.0.0.1 -P$P -uroot ping >/dev/null 2>&1 && break; sleep 1; done
  mysql --no-defaults -h127.0.0.1 -P$P -uroot -e "$SQL" || echo "  SQL failed"
  ( cd $L && exec env -i PATH=/usr/bin:/bin HOME=$L SERVER_PORT=$SP SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:$P/qwen_managed_agent" SPRING_DATASOURCE_USERNAME=qwen SPRING_DATASOURCE_PASSWORD=replace-me $J -jar $JAR > $L/boot.log 2>&1 ) & JP=$!
  res=TIMEOUT
  for i in $(seq 1 90); do
    if grep -q 'Started ManagedAgentServerApplication' $L/boot.log; then res="STARTED health=$(curl --noproxy '*' -sS -m 3 http://127.0.0.1:$SP/actuator/health)"; break; fi
    if ! kill -0 $JP 2>/dev/null; then res="EXITED: $(grep -m1 -oE "SELECT command denied[^']*'[^']*'[^']*'[^']*'" $L/boot.log) | $(grep -m1 -oE "Unable to determine value for 'foreign_key_checks' variable" $L/boot.log)"; break; fi
    sleep 1
  done
  echo "  boot as qwen: $res"
  kill $JP 2>/dev/null; for i in $(seq 1 20); do kill -0 $JP 2>/dev/null || break; sleep 0.5; done; kill -9 $JP 2>/dev/null
  kill $MPID; wait $MPID 2>/dev/null; rm -rf $L
done
