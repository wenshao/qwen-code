#!/bin/bash
S=$SCRATCH
W=$MUT_WORKTREE/packages/sdk-java/managed-agent-server
export JAVA_HOME=$JDK21 PATH=$JDK21/bin:$PATH
M="mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$S/m2/repository"
cd $W && $M -q test-compile > $S/specmut/compile.log 2>&1 || { echo compile failed; exit 1; }
R=target/classes/openapi/managed-agent-public-api.openapi.json
cp $R $S/specmut/original.json
run() { # run <label>
  rm -rf target/surefire-reports
  $M surefire:test -Dtest=PlannedTaskContractTest > $S/specmut/last.log 2>&1
  local t=$(grep -E "Tests run: [0-9]+, Fail" $S/specmut/last.log | tail -1 | sed 's/.*Tests run/Tests run/')
  local n=$(cat target/surefire-reports/*.txt 2>/dev/null | grep -oE "(PublicTask|WebShellTask|PublicCommand|WebShellCommand|PublicOperation|WebShellOperation)[A-Za-z]* [^:]*: expected (valid|invalid)" | sort -u | wc -l | tr -d ' ')
  local pub=$(cat target/surefire-reports/*.txt 2>/dev/null | grep -oE "(Public)[A-Za-z]* [^:]*: expected (valid|invalid)" | sort -u | wc -l | tr -d ' ')
  local ws=$(cat target/surefire-reports/*.txt 2>/dev/null | grep -oE "(WebShell)[A-Za-z]* [^:]*: expected (valid|invalid)" | sort -u | wc -l | tr -d ' ')
  if echo "$t" | grep -q "Failures: 0, Errors: 0"; then v=SURVIVED; else v=KILLED; fi
  printf "%-8s failing-instances=%-3s (public %s, webshell %s)  %s\n" "$v" "$n" "$pub" "$ws" "$1"
}
run "M0 unmodified spec"
while IFS=$'\t' read -r file name; do
  cp "$file" $R; run "$name"
done < $S/specmut/index.tsv
cp $S/specmut/original.json $R
