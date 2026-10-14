#!/bin/bash
# Precedent: main's own #13642 edited V1 in place after #14069. A DB created by
# main@91385884eb (pre-#13642) booted with current main@462cae3dd8 (base3).
set -u
cd /root/pr13986-rig
O=out/precedent; mkdir -p $O; : > $O/steps.log
log() { echo "$(date +%T) $*" | tee -a $O/steps.log; }
M() { mysql --socket=db/s.sock -uroot -pr13986 -N -B "$@"; }
URL="jdbc:mysql://127.0.0.1:13986/sp_pre?useSSL=false&allowPublicKeyRetrieval=true"
M -e "DROP DATABASE IF EXISTS sp_pre; CREATE DATABASE sp_pre;"
boot() {
  env -i HOME=/tmp PATH=/usr/bin:/bin ./jdk21/bin/java -jar server/$1.jar --server.address=127.0.0.1 --server.port=18997 \
    --spring.datasource.url="$URL" --spring.datasource.username=root --spring.datasource.password=r13986 > $O/$2 2>&1 &
  local pid=$!
  for i in $(seq 1 150); do
    grep -q -E "Started ManagedAgentServerApplication|APPLICATION FAILED|Application run failed" $O/$2 && break
    kill -0 $pid 2>/dev/null || break; sleep 1
  done
  sleep 1
  log "boot $1: $(grep -h -o -E 'Started ManagedAgentServerApplication in [0-9.]+ seconds' $O/$2) | $(grep -h -o -E '(Managed schema[^:]*: [^"]{0,140}|Migration checksum mismatch for migration version [0-9]+|Successfully applied [0-9]+ migration[^,]*, now at version v[0-9]+)' $O/$2 | sort -u | tr '\n' ';')"
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
}
boot pre13642 pre-fresh.log
boot base3 base3-on-pre.log
M -e "DROP DATABASE IF EXISTS sp_pre"
log DONE
