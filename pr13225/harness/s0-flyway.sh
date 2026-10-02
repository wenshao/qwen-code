#!/bin/bash
# S0: does each jar boot against (a) an empty database and (b) a database main already migrated?
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/rig; B=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin; C=(-uroot -ppw13225 -h127.0.0.1 -P43225)
boot() { # arm db label
  local arm=$1 db=$2 label=$3; local log=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/rig/run/s0-$label.log
  (cd /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/rig && JAR_ARM=$arm GC=none GRACE=none exec ./spring.sh $db 48225 49225) > $log 2>&1 < /dev/null &
  local pid=$!; local result=timeout
  for i in $(seq 1 240); do
    if ! kill -0 $pid 2>/dev/null; then result="exited"; break; fi
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:48225/actuator/health 2>/dev/null | grep -q 200; then result="healthy"; break; fi
    sleep 1
  done
  [ "$result" = healthy ] && { kill $pid; for i in $(seq 1 30); do kill -0 $pid 2>/dev/null || break; sleep 1; done; }
  wait $pid 2>/dev/null
  echo "[$label] arm=$arm db=$db result=$result"
  grep -o "Found more than one migration with version [0-9]*[^\"]*" $log | head -1 | cut -c1-300
  grep -o "Validate failed: [^\"]*" $log | head -1 | cut -c1-300
  $B/mysql "${C[@]}" -N -e "SELECT CONCAT('  history: ', GROUP_CONCAT(CONCAT('V',version,' ',description,IF(success,'',' FAILED')) ORDER BY installed_rank SEPARATOR ' | ')) FROM $db.flyway_schema_history WHERE version >= 31" 2>/dev/null
}
for db in s0raw s0m34 s0main s0upg s0head s0headmain; do $B/mysql "${C[@]}" -e "DROP DATABASE IF EXISTS $db" 2>/dev/null; done
boot mergeraw s0raw "raw-merge-empty-db"
boot merge34 s0m34 "renumbered-empty-db"
boot base s0upg "main-then"
boot merge34 s0upg "upgrade-main-db-to-renumbered"
boot head s0head "pr-head-alone"
boot base s0head "main-on-pr-head-db"
