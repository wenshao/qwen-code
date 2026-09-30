#!/bin/bash
# Round 15 migration checks for PR #12894 head 0027f7a7 (jar pr15, V22 added).
#  1. main jar (main14, V19) on a fresh schema, then the PR jar upgrades it in place.
#  2. The PR jar upgrades the round-14 schema o4a (V21) in place.
#  3. The PR jar on a fresh schema o5a.
R=$(cd $(dirname $0); pwd)
OUT=$R/out/flyway-checks-r15.txt; : > $OUT
say() { echo "$*" | tee -a $OUT; }
stop_spring() {
  local sp; sp=$(lsof -nP -iTCP:18894 -sTCP:LISTEN -t)
  [ -z "$sp" ] && return
  ps -o command= -p $sp | grep -q "server.port=18894" || { say "listener $sp on 18894 is not the rig Spring"; exit 1; }
  local tp; tp=$(ps -ax -o pid=,command= | awk '/[E]xTap 15894/{print $1}')
  local kids; kids=$(ps -ax -o pid=,ppid= | awk -v p=$sp '$2==p{print $1}')
  kill $sp $tp $kids 2>/dev/null
  for i in $(seq 1 30); do lsof -nP -iTCP:18894 -sTCP:LISTEN -t >/dev/null || break; sleep 1; done
}
history() { DB=$1 $R/sql.sh -N -B -e "SELECT CONCAT('V', version, ' ', description, ' success=', success) FROM flyway_schema_history ORDER BY installed_rank" 2>&1 | tail -${2:-4}; }
start() { # jar db
  DB=$2 ROOTS=$R/roots-r15 BROKER_TOKEN=hosted-tools-broker-token PUB_PORT=18895 $R/up14.sh $1 $HOME/git/qwen-code-pr12894 2>&1 | tail -1
  grep -m3 -E "Migrating schema|Successfully applied|Schema .* is up to date|FlywayValidateException|checksum mismatch|APPLICATION FAILED" $R/run/spring-$2.log | cut -c1-200 | sed 's/^/    log: /' | tee -a $OUT
}
stop_spring
for db in o5m o5a; do DB=mysql $R/sql.sh -e "DROP DATABASE IF EXISTS $db"; done
say "## 1. main jar (main14) on fresh o5m, then PR jar (pr15)"
start main14 o5m | tee -a $OUT; say "  after main jar:"; history o5m 2 | sed 's/^/    /' | tee -a $OUT; stop_spring
start pr15 o5m | tee -a $OUT; say "  after PR jar:"; history o5m 4 | sed 's/^/    /' | tee -a $OUT; stop_spring
say "## 2. PR jar (pr15) on the round-14 schema o4a (was V21)"
start pr15 o4a | tee -a $OUT; history o4a 3 | sed 's/^/    /' | tee -a $OUT
DB=o4a $R/sql.sh -N -B -e "SELECT CONCAT('    recovery_deadline column: ', COLUMN_TYPE, ' nullable=', IS_NULLABLE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='o4a' AND TABLE_NAME='qwen_tool_publication_operation' AND COLUMN_NAME='recovery_deadline'; SELECT CONCAT('    existing operation rows: ', COUNT(*), ', with recovery_deadline set: ', SUM(recovery_deadline IS NOT NULL)) FROM qwen_tool_publication_operation" | tee -a $OUT
stop_spring
say "## 3. PR jar (pr15) on fresh o5a"
start pr15 o5a | tee -a $OUT; history o5a 4 | sed 's/^/    /' | tee -a $OUT
DB=o5a $R/sql.sh -N -B -e "SELECT CONCAT('    migrations applied: ', COUNT(*), ', all successful: ', MIN(success)) FROM flyway_schema_history WHERE version IS NOT NULL" | tee -a $OUT
say "## done (Spring left running on o5a)"
