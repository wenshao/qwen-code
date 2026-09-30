#!/bin/bash
# Run the three focused contract suites against each mutated contract placed on
# the test classpath of an APFS copy of the head module (target/ already built).
set -u
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/12fa9b24-1d30-4fad-b831-ba32169a2e71/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH="$JAVA_HOME/bin:$PATH"
MOD=$SP/wt-mut/packages/sdk-java/managed-agent-server
OUT=$SP/pr12998/mutlogs
mkdir -p "$OUT"
: target copied from wt-pr
CP="$MOD/target/classes/openapi/managed-agent-public-api.openapi.json"
ORIG=$SP/pr12998/mutorig.json
cp "$CP" "$ORIG"
TESTS=PlannedTaskContractTest,ManagedAgentApiContractTest,ManagedSessionStoreContractFixtureTest
run() {
  local id=$1
  mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$SP/m2repo -f "$MOD/pom.xml" \
    surefire:test -Dtest=$TESTS > "$OUT/$id.log" 2>&1
  local rc=$?
  local sum
  sum=$(grep -E "^\[(INFO|ERROR|WARNING)\] Tests run: [0-9]+, Failures" "$OUT/$id.log" | tail -1 | sed 's/^\[[A-Z]*\] //')
  echo "$id rc=$rc $sum" | tee -a "$OUT/summary.txt"
}
run baseline-unmutated
for f in "$SP"/pr12998/mut/*.json; do
  id=$(basename "$f" .json)
  cp "$f" "$CP"
  run "$id"
  cp "$ORIG" "$CP"
done
cmp "$ORIG" "$SP/wt-pr/packages/sdk-java/managed-agent-server/target/classes/openapi/managed-agent-public-api.openapi.json" && echo "restored ok" | tee -a "$OUT/summary.txt"
