#!/bin/bash
# inside VM: Flyway startup of the merged tree (PR head 0919b9d8 + main 3f56f74a: two V27 scripts) and of the V28
# candidate, on a fresh database and on databases first migrated by main or by the PR head. Fresh DB per arm.
set -u
RIG=/Users/wenshao/pr13138-rig; O=$RIG/out/e2e-m3; mkdir -p $O
grep -q '^HOOKS=' /etc/qwen-w1b.env || echo 'HOOKS=0' | sudo tee -a /etc/qwen-w1b.env > /dev/null
q() { docker exec w0e3-db mysql -uroot -prootpw -N -e "$1" 2>/dev/null; }
hist() { q "SELECT CONCAT(version,':',description,':',IF(success,'ok','FAILED')) FROM $1.flyway_schema_history WHERE CAST(version AS UNSIGNED) >= 26 ORDER BY installed_rank" | paste -sd ' ' -; }
tables() { q "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$1' AND table_name LIKE 'managed_workspace_recovery_%'"; }
hookcol() { q "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$1' AND table_name='qwen_managed_session_extension_record' AND column_name='first_sequence'"; }
start() { # label db jar
  local t0=$(date +%s%N)
  : > /var/log/qwen-w1b/server.log
  local r; r=$(bash $RIG/vm/svc.sh JAR=$3 DB=$2 restart 2>&1 | tail -1)
  local ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  echo "== $1: db=$2 jar=$3 -> $(systemctl is-active qwen-w1b.service) after ${ms} ms | $r"
  echo "   flyway history (>=26): [$(hist $2)] recovery tables=$(tables $2) hook first_sequence column=$(hookcol $2)"
  grep -a -E "FlywayException|Found more than one migration|Validate failed|Migration (checksum|description|type) mismatch|Detected (resolved|applied) migration|Successfully (applied|validated)|Migrating schema|Schema .* is up to date|APPLICATION FAILED|Current version of schema" /var/log/qwen-w1b/server.log \
    | grep -v '^\s*at ' | sed -E 's/^.*(o\.f\.c\.|org\.flywaydb|Caused by: |Error creating bean)/\1/' | cut -c1-330 | awk '!seen[$0]++' | head -8 | sed 's/^/   | /'
  cp /var/log/qwen-w1b/server.log $O/flyway-$1.log
}
stop() { bash $RIG/vm/svc.sh stop; }
fresh() { bash $RIG/vm/reset.sh $1 JAR=$2 DIST=dist-r3 VERIFIED=false PUB=0 HOOKS=0 MCP=0 > /dev/null 2>&1; }

echo "jars: $(cd /opt/w1b && sha256sum mainh2-server.jar m3-server.jar m3c-server.jar r3-server.jar | awk '{print $2"="substr($1,1,12)}' | paste -sd ' ' -)"
fresh w1b_m3f1 m3-server.jar;  start F1-merged-fresh       w1b_m3f1 m3-server.jar; stop
fresh w1b_m3f2 mainh2-server.jar; start F2a-main-fresh     w1b_m3f2 mainh2-server.jar; stop
                                  start F2b-main-then-merged w1b_m3f2 m3-server.jar; stop
                                  start F2c-main-then-cand   w1b_m3f2 m3c-server.jar; stop
fresh w1b_m3f3 m3c-server.jar; start F3-cand-fresh         w1b_m3f3 m3c-server.jar; stop
fresh w1b_m3f4 r3-server.jar;  start F4a-prhead-fresh      w1b_m3f4 r3-server.jar; stop
                               start F4b-prhead-then-cand  w1b_m3f4 m3c-server.jar; stop
                               start F4c-prhead-then-main  w1b_m3f4 mainh2-server.jar; stop
echo FLYWAY-DONE
