#!/bin/bash
# Real-MySQL migration checks for round 4. One Spring at a time on lane 1.
R=$(cd $(dirname $0); pwd); LOG=$R/out/flyway-r4.log
hist() { DB=$1 $R/sql.sh -N -e "SELECT CONCAT(GROUP_CONCAT(version ORDER BY installed_rank SEPARATOR ','), ' (', COUNT(*), ' rows, failed=', SUM(success=0), ')') FROM flyway_schema_history" 2>&1 | tail -1; }
start() { local jar=$1 db=$2; LANE=1 $R/stop-l.sh >/dev/null; echo "-- start $jar on $db" | tee -a $LOG; LANE=1 DB=$db ROOTS=$R/roots-F $R/up-l.sh $jar $HOME/git/qwen-code-pr13654 2>&1 | tail -1 | tee -a $LOG; local f=$(ls -t $R/run/spring-lane1-$db-*.log | head -1); python3 - "$f" <<'PY' | tee -a $LOG
import re,sys
s=open(sys.argv[1],errors='replace').read()
for pat in [r'Successfully applied \d+ migrations?[^\n]*', r'Schema `[^`]*` is up to date[^\n]*', r'Found more than one migration with version \d+', r'Validate failed: [^\n]{0,300}', r'Detected resolved migration not applied to database: [^\n]{0,80}', r'Migration checksum mismatch[^\n]{0,200}', r'Started ManagedAgentServerApplication[^\n]{0,60}']:
    m=re.findall(pat,s)
    if m: print('   ', m[0][:300])
PY
echo "   history: $(hist $db)" | tee -a $LOG; }
: > $LOG
echo "== G1 main 2ebbd4e1 (merge base, top V62) on a fresh schema, then PR head 50312cfb on the same schema" | tee -a $LOG; start base4 p654g1; start head4 p654g1
echo "== G2 PR head 50312cfb on a fresh schema" | tee -a $LOG; start head4 p654g2
echo "== G3 schema migrated by the previous PR head 915ab691 (async table at V61), then 50312cfb (same DDL at V63)" | tee -a $LOG; start head3 p654g3; start head4 p654g3
LANE=1 $R/stop-l.sh >/dev/null; echo "== done" | tee -a $LOG
