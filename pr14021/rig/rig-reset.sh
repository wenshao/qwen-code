#!/bin/bash
# rig-reset.sh — rig MAINTENANCE, not product behavior: stop this rig's own
# processes (by PID: pidfiles + processes running this rig's binaries), empty
# this rig's cgroup units, wipe the durable runtime state, and recreate the
# arm's database (Flyway re-migrates on the next Spring boot).
set -u
cd "$(dirname "$0")"
source ./rig-env.sh

pids=$( (for f in spring harness fake-model oss-shim bproxy sproxy; do cat "$RIG/$f.pid" 2>/dev/null; echo; done; rig_pids) | grep -E '^[0-9]+$' | sort -u)
[ -n "$pids" ] && kill $pids 2>/dev/null
for i in $(seq 1 20); do
  alive=$(for p in $pids; do kill -0 $p 2>/dev/null && echo $p; done)
  [ -z "$alive" ] && break
  sleep 0.5
done
[ -n "${alive:-}" ] && kill -9 $alive 2>/dev/null
left=$(rig_pids)
[ -n "$left" ] && kill -9 $left 2>/dev/null

clean=0
for d in "$CGROUP_ROOT"/qwen-*; do
  [ -d "$d" ] || continue
  echo 1 > "$d/cgroup.kill" 2>/dev/null || true
  sleep 0.3
  rmdir "$d" 2>/dev/null && clean=$((clean+1)) || true
done
echo "units removed: $clean; remaining: $(ls -d "$CGROUP_ROOT"/qwen-* 2>/dev/null | wc -l)"

rm -rf "$STATE_DIR" "$RIG/oss-store" "$MOUNTS"
mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
rm -f "$RIG"/{spring,harness,fake-model,oss-shim,bproxy,sproxy}.pid

if [ "${KEEP_DB:-0}" != 1 ]; then
  sql_db "DROP DATABASE IF EXISTS $DB_NAME; CREATE DATABASE $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;"
  echo "db $DB_NAME recreated"
fi
echo "reset done; rig pids left: $(rig_pids | wc -l)"
