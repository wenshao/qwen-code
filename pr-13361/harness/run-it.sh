#!/usr/bin/env bash
# Usage: run-it.sh <label> <arm A|T|H> <lane> [ENV=VAL ...]
#   A = main 9915c7f (PR base), T = base + PR's hosted-harness-session.ts (tags only), H = PR head 1dcda71.
#   STALL_MS=<ms> stalls the daemon loop on the first /resources/ fetch of the armed javaLoad.
#   GOALS overrides the Maven goals (first run needs test-compile).
set -u
LABEL=$1; ARM=$2; LANE=$3; shift 3
R=/root/verify/pr13361
case $ARM in A) CLI=$R/base/dist/cli.js;; T) CLI=$R/tags/dist/cli.js;; H) CLI=$R/head/dist/cli.js;; M) CLI=$R/headmut/dist/cli.js;; *) echo bad arm; exit 2;; esac
MOD=${MOD:-$R/mas-$LANE}
DB=v13361_l$LANE
OUT=$R/runs/$LABEL
rm -rf "$OUT"; mkdir -p "$OUT"
docker exec my13361 mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB;" 2>/dev/null
rm -rf "$MOD/target/failsafe-reports"
STALL=${STALL_MS:-0}
FLAG=""; [ "$STALL" -gt 0 ] && FLAG=$OUT/stall.flag
PRE="file://$OUT/../../harness/fetch-probe.mjs?log=$OUT/fetch.jsonl&stall=$STALL&flag=$OUT/stall.flag&nth=${STALL_NTH:-1}&on=${STALL_ON:-resource}"
export JAVA_HOME=/usr/local/jdk21 PATH=/usr/local/jdk21/bin:$PATH
T0=$(date +%s)
( cd "$MOD" && env TZ=UTC VERIFY_DAEMON_LOG="$OUT/daemon.log" VERIFY_DAEMON_PRELOAD="$PRE" \
    VERIFY_STORE_LOG="$OUT/store.jsonl" VERIFY_STALL_FLAG="$FLAG" "$@" \
  mvn ${MVN_OFFLINE--o} -B -ntp -Dmaven.repo.local=$R/m2 -Dmaven.repo.local.tail=/root/.m2/repository \
    -Phosted-harness-mysql -Dnode.executable="$(command -v node)" -Dqwen.cli.entry="$CLI" \
    "-Dmysql.url=jdbc:mysql://127.0.0.1:33361/$DB?allowPublicKeyRetrieval=true&useSSL=false" \
    -Dmysql.user=root -Dmysql.password=hosted-fixture \
    -Dit.test='HostedWorkspaceToolTurnIT#packagedHarnessUsesSavedWorkspacesThroughRealBrokerWorkerAndSqlStore' \
    -Dfailsafe.rerunFailingTestsCount=0 -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true \
    ${GOALS:-failsafe:integration-test failsafe:verify} > "$OUT/mvn.log" 2>&1 )
EXIT=$?
cp "$MOD"/target/failsafe-reports/TEST-*HostedWorkspaceToolTurnIT.xml "$OUT/" 2>/dev/null
{
  echo "EXIT=$EXIT $(( $(date +%s)-T0 ))s arm=$ARM lane=$LANE stall=$STALL nth=${STALL_NTH:-1} on=${STALL_ON:-resource} $*"
  grep -hE 'Tests run:.*HostedWorkspaceToolTurnIT' "$OUT/mvn.log" | head -1
  grep -hoE 'AssertionError \[ERR_ASSERTION\]: .{0,120}|tool-turn-driver\.ts:[0-9]+:[0-9]+' "$OUT"/*.xml 2>/dev/null | sort -u | head -4
} > "$OUT/result"
cat "$OUT/result"
