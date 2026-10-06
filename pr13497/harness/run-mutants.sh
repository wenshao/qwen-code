#!/bin/bash
# PR #13497 mutation matrix runner: H2 lane = the PR's two new channel test
# classes; MySQL lane = the PR's ManagedChannelJdbcContract on MySQL 8.4.7.
set -u
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8a9ac9cc-e152-4b48-b948-f12731d40cd3/scratchpad
W=$S/wt-mut
M=$W/packages/sdk-java/managed-agent-server
OUT=$S/results/mutants.tsv
LOGS=$S/logs/mutants
export JAVA_HOME=$HOME/Install/jdk21 TZ=UTC
mkdir -p "$LOGS"
MYSQL_URL='jdbc:mysql://127.0.0.1:33497/mysql?allowPublicKeyRetrieval=true&useSSL=false'
MVN=(mvn -B -o -ntp -Dmaven.repo.local=$S/m2 -Dcheckstyle.skip -Dspotbugs.skip=true)
printf 'id\th2_lane\tmysql_contract\tmysql_case_probe\n' > "$OUT"

restore() {
  git -C "$W" checkout -q -- packages/sdk-java/managed-agent-server/src/main
  if [ -n "$(git -C "$W" status --porcelain -- packages/sdk-java/managed-agent-server/src/main)" ]; then
    echo "restore failed" >&2; exit 1
  fi
}

ids=(M00 $(python3 $S/harness/mutants.py list | cut -f1))
for id in "${ids[@]}"; do
  restore
  if [ "$id" != M00 ]; then
    python3 $S/harness/mutants.py "$id" "$W" > /dev/null || { printf '%s\tAPPLY-FAILED\t-\t-\n' "$id" >> "$OUT"; continue; }
  fi
  log=$LOGS/$id-h2.log
  (cd "$M" && "${MVN[@]}" test -Dtest='ManagedChannelJdbcContractTest,PlannedChannelContractTest' -Dsurefire.failIfNoSpecifiedTests=false) > "$log" 2>&1
  if grep -q "COMPILATION ERROR" "$log"; then
    h2=COMPILE-ERROR
  elif grep -q "BUILD SUCCESS" "$log"; then
    h2="survived ($(grep -E '^\[INFO\] Tests run: [0-9]+, Failures' "$log" | tail -1 | sed 's/\[INFO\] //'))"
  else
    h2="killed ($(grep -E '^\[(ERROR|INFO)\] Tests run: [0-9]+, Failures' "$log" | tail -1 | sed -E 's/\[(ERROR|INFO)\] //'))"
  fi
  only=contract
  [ "$id" = M16 ] && only=all
  plog=$LOGS/$id-mysql.log
  tsv=$LOGS/$id-mysql.tsv
  rm -f "$tsv"
  (cd "$M" && "${MVN[@]}" surefire:test -Dtest=Pr13497RealDbProbeTest -Dsurefire.failIfNoSpecifiedTests=false \
    -Dprobe.arm=mysql84 "-Dprobe.url=$MYSQL_URL" -Dprobe.user=root -Dprobe.password=pr13497 \
    -Dprobe.only=$only -Dprobe.out=$tsv) > "$plog" 2>&1
  mc=$(awk -F'\t' '$3=="contract"{print $4}' "$tsv" 2>/dev/null | cut -c1-90)
  [ -z "$mc" ] && mc="NO-RESULT"
  case_probe=$(awk -F'\t' '$3=="case delivery_id rows"{print $4}' "$tsv" 2>/dev/null)
  printf '%s\t%s\t%s\t%s\n' "$id" "$h2" "$mc" "${case_probe:--}" >> "$OUT"
  echo "$id done: $h2 | $mc"
done
restore
echo ALL-DONE
