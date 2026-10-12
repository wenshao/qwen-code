#!/bin/bash
# Round 9: main #13777's cleanup-debt release (POST tool-sessions/<rs>:release with cleanupBindingId) before and after
# the retention sweep removes the original binding family, on the real jar.
# usage: probe9r.sh <mysql|maria> <jar> <tag>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; JAR=$2; T=$3; P=QWEN_MANAGED_AGENT_RUNTIME; N=p9r_${T//-/_}
export SERVER_PORT=18732 BROKER_PORT=18733 CPDIR=${CPDIR:-cp-r9m} SEEDOUT=${SEEDOUT:-out-r9m}
[ "$DB" = mysql ] && PORT=33642 || PORT=43642
Q() { /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -N $N -e "$1" 2>/dev/null; }
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid 2>/dev/null; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
# The exact request hosted-turn-cleanup.ts reconcile makes through HostedWorkspaceBroker.release({bindingId, generation})
rel() { curl -s -w ' HTTP=%{http_code}' -X POST -H 'Authorization: Bearer pr13642-broker-token-0123456789abcdef' -H 'content-type: application/json' \
  "http://127.0.0.1:$BROKER_PORT/internal/runtime-broker/v1/tool-sessions/$1-rs:release" \
  -d "{\"protocolVersion\":1,\"requestId\":\"r-$RANDOM\",\"harnessSessionId\":\"harness-$1\",\"cleanupBindingId\":\"$1\",\"cleanupGeneration\":\"1\"}" \
  | sed -E 's/.*"code":"([a-z_]+)".* HTTP=([0-9]+)/HTTP=\2 code=\1/; s/.*"released":(true|false).* HTTP=([0-9]+)/HTTP=\2 released=\1/'; }
fam() { Q "SELECT b.binding_id, b.binding_state, (SELECT COUNT(*) FROM qwen_runtime_session s WHERE s.binding_id=b.binding_id), (SELECT COUNT(*) FROM qwen_tool_execution x WHERE x.binding_id=b.binding_id) FROM qwen_runtime_binding b WHERE b.binding_id LIKE 'r-%' ORDER BY 1" | awk -F'\t' '{printf "    %-14s %s sessions=%s executions=%s\n", $1, $2, $3, $4}'; n=$(Q "SELECT COUNT(*) FROM qwen_runtime_binding WHERE binding_id LIKE 'r-%'"); [ "$n" = 0 ] && echo "    (no r-* bindings left)"; }
/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$PORT -e "DROP DATABASE IF EXISTS $N" 2>/dev/null
echo "## [$T] jar=$(basename $JAR) db=$N"
R=$($S/rig/boot.sh $JAR $DB $N $T-schema ${P}_BROKER_ENABLED=true); [ "${R%% *}" = STARTED ] || { echo "schema boot: $R"; exit 1; }; stop $T-schema
# r-debt-done: a dormant Session's original family (binding drained + RELEASED 40 days ago, Session isolation,
# Runtime Session RELEASED, executions SETTLED); its background Shell record is settled, so no guard clause applies.
out=$($S/rig/seed.sh $DB $N stranded r-debt-done 2>&1); m=$(echo "$out" | grep -E "^STRANDED r-debt-done "); [ -n "$m" ] || { echo "$out" | head -3; echo "seed failed"; exit 1; }; echo "$m"
echo "1. seeded family:"; fam
R=$($S/rig/boot.sh $JAR $DB $N $T-off ${P}_BROKER_ENABLED=true); [ "${R%% *}" = STARTED ] || { echo "boot: $R"; exit 1; }
a=$(rel r-debt-done); b=$(rel r-debt-done)
echo "2. retention off — cleanup reconcile's release(cleanupBindingId=r-debt-done, generation=1): $a; repeated: $b"
stop $T-off
case "$a" in *"HTTP=200 released=true"*) ;; *) echo "PRECONDITION FAILED: the release must be confirmed before the sweep"; exit 1;; esac
R=$($S/rig/boot.sh $JAR $DB $N $T-on ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=30d ${P}_RETENTION_SCAN_DELAY=3s)
[ "${R%% *}" = STARTED ] || { echo "boot: $R"; exit 1; }
sleep 15
echo "3. retention on (30d, scan 3s), after 15 s:"; grep -E 'runtime_retention bindings_scanned' $S/rig/logs/$T-on.log | sed -E 's/.*runtime_retention //;s/ duration_ms=[0-9]+//' | sort | uniq -c | sed -E 's/^ +/    /'
fam
echo "    same release after the sweep:           $(rel r-debt-done)"
echo "    control, a binding id that never existed: $(rel r-never-existed)"
stop $T-on
echo "## [$T] done"
