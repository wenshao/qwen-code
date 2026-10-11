#!/bin/bash
# Real-MySQL migration checks for report round 5 (head fe0ae13e = 569befb8 + main a8990042). One Spring at a time on lane 1.
R=$(cd $(dirname $0); pwd); LOG=$R/out/flyway-r7.log
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
echo "== G1 merge base 6936c77e (main, top V67; main a8990042 adds no migration) on a fresh schema, then fe0ae13e on the same schema" | tee -a $LOG; start base5 p654n1; start merge6 p654n1
echo "== G2 fe0ae13e on a fresh schema" | tee -a $LOG; start merge6 p654n2
echo "== G3 schema at 569befb8 (V68), then fe0ae13e" | tee -a $LOG; start head5 p654n3; start merge6 p654n3
LANE=1 $R/stop-l.sh >/dev/null; echo "== done" | tee -a $LOG
