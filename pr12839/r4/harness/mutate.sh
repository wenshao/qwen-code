#!/bin/bash
# Mutation matrix for PR 12839 W0e-1 guards. Runs in the dedicated wt-mut worktree.
# Usage: mutate.sh <suite: unit|gates> <mutant ids...>
set -u
SP=<scratch>
WT=$SP/wt-mut
PKG=packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker
OUT=$SP/r4ev/mutants
mkdir -p "$OUT"
suite=$1; shift

apply() {
  local id=$1
  cd "$WT" || exit 1
  case $id in
    M1) perl -0pi -e 's/return lossEvidence != null && stopEvidence != null;/return lossEvidence != null;/' $PKG/RuntimeBindingRecord.java ;;
    M2) perl -0pi -e 's/if \(!current\.hasStoppedWriters\(\)(\s*\|\| JdbcToolExecutionRepository\.hasActiveByBinding)/if (false$1/' $PKG/JdbcRuntimeBindingRepository.java ;;
    M3) perl -0pi -e 's/if \(!current\.hasStoppedWriters\(\)(\s*\|\| executions\.hasActiveByBinding)/if (false$1/' $PKG/InMemoryRuntimeBindingRepository.java ;;
    M4) perl -0pi -e 's/&& !binding\.hasStoppedWriters\(\)\) \{\n(\s*)throw new RuntimeBrokerException\(503, "runtime_reconciliation_required"/&& binding.getLossEvidence() == null) {\n$1throw new RuntimeBrokerException(503, "runtime_reconciliation_required"/' $PKG/RuntimeAdmission.java ;;
    M5) perl -0pi -e 's/&& binding\.hasStoppedWriters\(\)\n(\s*)&& !executionRepository\.hasActiveByRuntimeSession/&& binding.getLossEvidence() != null\n$1&& !executionRepository.hasActiveByRuntimeSession/' $PKG/RuntimeBrokerService.java ;;
    M6) perl -0pi -e 's/\.filter\(record -> !record\.isTerminal\(\)\)/.filter(record -> record.getState() != ToolExecutionRecord.State.ABANDONED)/' $PKG/InMemoryToolExecutionRepository.java
        perl -0pi -e 's/if \(isTerminal\(\) \|\| binding\.getState\(\) != RuntimeBindingRecord\.State\.LOST/if (state == State.ABANDONED || binding.getState() != RuntimeBindingRecord.State.LOST/' $PKG/ToolExecutionRecord.java ;;
    M7) perl -0pi -e 's/AND execution_state NOT IN \(\x27SETTLED\x27, \x27ABANDONED\x27\) "\n(\s*)\+ "ORDER BY execution_call_id_hash LIMIT 100 FOR UPDATE"/AND execution_state NOT IN (\x27ABANDONED\x27) "\n$1+ "ORDER BY execution_call_id_hash LIMIT 100 FOR UPDATE"/' $PKG/JdbcToolExecutionRepository.java
        perl -0pi -e 's/if \(isTerminal\(\) \|\| binding\.getState\(\) != RuntimeBindingRecord\.State\.LOST/if (state == State.ABANDONED || binding.getState() != RuntimeBindingRecord.State.LOST/' $PKG/ToolExecutionRecord.java ;;
    M8) perl -0pi -e 's/&& \(!request\.isManagedContext\(\)\n(\s*)\|\| !LocalProcessRuntimeProvisioner\.KIND/&& (true || !request.isManagedContext()\n$1|| !LocalProcessRuntimeProvisioner.KIND/' $PKG/RuntimeBindingRecord.java ;;
    M9) perl -0pi -e 's/&& \(!request\.isManagedContext\(\)\n(\s*)\|\| !LocalProcessRuntimeProvisioner\.KIND/&& (false\n$1|| !LocalProcessRuntimeProvisioner.KIND/' $PKG/RuntimeBindingRecord.java ;;
    M10) perl -0pi -e 's/public boolean canRetryFailedConfirm\(RuntimeLease lease\) \{\n(\s*)return isUsable\(lease\);/public boolean canRetryFailedConfirm(RuntimeLease lease) {\n$1return true;/' $PKG/LocalProcessRuntimeProvisioner.java ;;
    M11) perl -0pi -e 's/public boolean canRetryFailedConfirm\(RuntimeLease lease\) \{\n(\s*)return isUsable\(lease\);/public boolean canRetryFailedConfirm(RuntimeLease lease) {\n$1return false;/' $PKG/LocalProcessRuntimeProvisioner.java ;;
    M12) perl -0pi -e 's/(static void requireReady\(RuntimeBindingRecord binding, long generation\) \{\n\s*if \(binding == null \|\| binding\.getGeneration\(\) != generation\n)\s*\|\| binding\.getState\(\) != RuntimeBindingRecord\.State\.READY\n/$1/' $PKG/RuntimeAdmission.java ;;
    M13) perl -0pi -e 's/boolean invalidate = cause instanceof RuntimeBrokerException failure\n(\s*)&& IDENTITY_FAILURES\.contains\(failure\.getCode\(\)\);/boolean invalidate = false;/' $PKG/RuntimeBrokerService.java ;;
    *) echo "unknown mutant $id"; return 1 ;;
  esac
}

for id in "$@"; do
  cd "$WT" || exit 1
  git checkout -q -- packages/sdk-java/runtime-broker/src/main
  apply "$id" || continue
  changed=$(git diff --numstat -- packages/sdk-java/runtime-broker/src/main | awk '{s+=$1+$2} END {print s+0}')
  if [ "$changed" -eq 0 ]; then
    echo "$id NOT-APPLIED" | tee -a "$OUT/summary-$suite.txt"
    continue
  fi
  git diff -- packages/sdk-java/runtime-broker/src/main > "$OUT/$id.diff"
  cd "$WT/packages/sdk-java/runtime-broker" || exit 1
  if [ "$suite" = unit ]; then
    JAVA_HOME=~/Install/jdk21 mvn -o -s $SP/m2-settings.xml -Dmaven.repo.local=$SP/m2repo \
      -Dcheckstyle.skip -Djacoco.skip=true test > "$OUT/$id-$suite.log" 2>&1
  else
    JAVA_HOME=~/Install/jdk21 mvn -o -s $SP/m2-settings.xml -Dmaven.repo.local=$SP/m2repo \
      -Dcheckstyle.skip -Djacoco.skip=true -Pfault-gates -Dqwen.cli.entry=$SP/wt-r4/dist/cli.js \
      -Dtest='!W0e*' -Dsurefire.failIfNoSpecifiedTests=false test > "$OUT/$id-$suite.log" 2>&1
  fi
  rc=$?
  line=$(grep -E "Tests run:.*Fail" "$OUT/$id-$suite.log" | tail -1 | sed 's/.*Tests run/Tests run/')
  compile=$(grep -c "COMPILATION ERROR" "$OUT/$id-$suite.log")
  if [ "$rc" -eq 0 ]; then verdict=SURVIVED; elif [ "$compile" -gt 0 ]; then verdict=COMPILE-ERROR; else verdict=KILLED; fi
  failing=$(grep -E "^\[ERROR\]   [A-Za-z]" "$OUT/$id-$suite.log" | sed 's/^\[ERROR\]   //' | cut -d: -f1 | sort -u | head -4 | tr '\n' ' ')
  echo "$id $verdict ($changed lines) $line | $failing" | tee -a "$OUT/summary-$suite.txt"
done
cd "$WT" && git checkout -q -- packages/sdk-java/runtime-broker/src/main
