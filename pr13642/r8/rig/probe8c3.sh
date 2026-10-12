#!/bin/bash
# Round 8: #13917's never-started proof vs the retention sweep, on the real jar.
# usage: probe8c.sh <mysql|maria> <jar> <tag>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; JAR=$2; T=$3; P=QWEN_MANAGED_AGENT_RUNTIME; N=p8c_${T//-/_}
export SERVER_PORT=18732 BROKER_PORT=18733 CPDIR=cp-r8c SEEDOUT=out-r8c
[ "$DB" = mysql ] && PORT=33642 || PORT=43642
Q() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -N $N -e "$1" 2>/dev/null; }
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid 2>/dev/null; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
# The exact read HostedWorkspaceBroker.backgroundProcessStatus makes: GET /executions/<call>%3Aprocess
probe() { curl -s -w ' HTTP=%{http_code}' -H 'Authorization: Bearer pr13642-broker-token-0123456789abcdef' \
  "http://127.0.0.1:$BROKER_PORT/internal/runtime-broker/v1/executions/$1-call%3Aprocess?protocolVersion=1&requestId=r-$RANDOM&harnessSessionId=harness-$1&runtimeSessionId=$1-rs" \
  | sed -E 's/.*"code":"([a-z_]+)".* HTTP=([0-9]+)/HTTP=\2 code=\1/; s/.*"executionCallId":"([^"]+)".*"state":"([a-z_]+)".* HTTP=([0-9]+)/HTTP=\3 executionCallId=\1 status.state=\2/'; echo; }
fam() { Q "SELECT b.binding_id, b.binding_state, (SELECT COUNT(*) FROM qwen_runtime_session s WHERE s.binding_id=b.binding_id), (SELECT GROUP_CONCAT(x.execution_call_id ORDER BY x.execution_call_id) FROM qwen_tool_execution x WHERE x.binding_id=b.binding_id) FROM qwen_runtime_binding b WHERE b.binding_id LIKE 's-%' ORDER BY 1" | awk -F'\t' '{printf "    %-9s %s sessions=%s executions=%s\n", $1, $2, $3, $4}'; n=$(Q "SELECT COUNT(*) FROM qwen_runtime_binding WHERE binding_id LIKE 's-%'"); [ "$n" = 0 ] && echo "    (no s-* bindings left)"; }
rec() { Q "SELECT session_id, record_id, task_kind, task_state, IFNULL(runtime_state,'-'), IFNULL(settled_at,'NULL') FROM qwen_managed_session_extension_record WHERE domain='child_run' ORDER BY record_id" | awk -F'\t' '{printf "    child_run %s/%s kind=%s state=%s runtime=%s settled_at=%s\n", $1, $2, $3, $4, $5, $6}'; }
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -e "DROP DATABASE IF EXISTS $N" 2>/dev/null
echo "## [$T] jar=$(basename $JAR) db=$N"
R=$($S/rig/boot.sh $JAR $DB $N $T-schema ${P}_BROKER_ENABLED=true); [ "${R%% *}" = STARTED ] || { echo "schema boot: $R"; exit 1; }; stop $T-schema
for f in s-strand s-done; do out=$($S/rig/seed.sh $DB $N stranded $f 2>&1); m=$(echo "$out" | grep -E "^STRANDED $f "); [ -n "$m" ] || { echo "$out" | head -3; echo "seed $f failed (no STRANDED marker)"; exit 1; }; echo "$m"; done
echo "1. seeded families (binding drained + RELEASED 40 days ago, Session isolation, top-level managed Session):"; fam; rec
R=$($S/rig/boot.sh $JAR $DB $N $T-off ${P}_BROKER_ENABLED=true); [ "${R%% *}" = STARTED ] || { echo "boot: $R"; exit 1; }
echo "2. retention off — the reconcile's probe:"; a=$(probe s-strand); b=$(probe s-done); echo "    s-strand: $a"; echo "    s-done:   $b"; stop $T-off
case "$a$b" in *"HTTP=200 executionCallId=s-strand-call:process status.state=settled"*"HTTP=200 executionCallId=s-done-call:process status.state=settled"*) ;; *) echo "PRECONDITION FAILED: both :process rows must answer 200 before the sweep"; exit 1;; esac
R=$($S/rig/boot.sh $JAR $DB $N $T-on ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=30d ${P}_RETENTION_SCAN_DELAY=3s)
[ "${R%% *}" = STARTED ] || { echo "boot: $R"; exit 1; }
sleep 15
echo "3. retention on (30d, scan 3s), after 15 s:"; grep -E 'runtime_retention bindings_scanned' $S/rig/logs/$T-on.log | sed -E 's/.*runtime_retention //;s/ duration_ms=[0-9]+//' | sort | uniq -c | sed -E 's/^ +/    /'
fam; echo "    s-strand probe: $(probe s-strand)"; echo "    s-done probe:   $(probe s-done)"; stop $T-on
echo "## [$T] done"
