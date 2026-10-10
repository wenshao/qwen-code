#!/bin/bash
# Real-MySQL migration checks for round 2. One Spring at a time on lane 1.
R=$(cd $(dirname $0); pwd); LOG=$R/out/flyway-r2.log
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
echo "== T1 trial merge as-is (two V57) on a fresh schema" | tee -a $LOG; start merge2 p654f1
echo "== T2 main 1f4484d3 to V60, then trial merge with the async migration renumbered to V61" | tee -a $LOG; start main2 p654f2; start merge2v61 p654f2
echo "== T3 main 1f4484d3 to V60, then trial merge with the async migration renumbered to V58 (free number below main's max)" | tee -a $LOG; start main2 p654f3; start merge2v58 p654f3
echo "== T4 fresh schema with the V58 variant (applies in order)" | tee -a $LOG; start merge2v58 p654f4
echo "== T5 PR head dc9e6abf on a fresh schema" | tee -a $LOG; start head2 p654f5
LANE=1 $R/stop-l.sh >/dev/null; echo "== done" | tee -a $LOG
