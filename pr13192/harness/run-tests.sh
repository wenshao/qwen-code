#!/bin/bash
# usage: run-tests.sh <worktree> <m2> <TZ> <mysql|mariadb> <dbname> <unit-tests|NONE> <it-tests|ALL> <outdir> [extra mvn args...]
W=$1; M2=$2; ZONE=$3; ENGINE=$4; DB=$5; UNIT=$6; ITS=$7; OUT=$8; shift 8
export JAVA_HOME=$HOME/Install/jdk21
export PATH=$JAVA_HOME/bin:$PATH
case $ENGINE in mysql) PORT=33192;; mariadb) PORT=33193;; *) echo bad engine; exit 2;; esac
mkdir -p "$OUT"
cd "$W/packages/sdk-java/managed-agent-server" || exit 2
rm -rf target/failsafe-reports target/surefire-reports
ARGS=(-B -ntp -Dmaven.repo.local="$M2" -Pmysql-integration
  "-Dmysql.url=jdbc:mysql://127.0.0.1:${PORT}/${DB}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
  -Dmysql.user=root -Dmysql.password=pr13192pw)
if [ "$UNIT" = NONE ]; then ARGS+=(-DskipTests=false -Dtest=NONE -Dsurefire.failIfNoSpecifiedTests=false); elif [ "$UNIT" != ALL ]; then ARGS+=("-Dtest=$UNIT" -Dsurefire.failIfNoSpecifiedTests=false); fi
if [ "$ITS" != ALL ]; then ARGS+=("-Dit.test=$ITS" -Dfailsafe.failIfNoSpecifiedTests=false); fi
echo "TZ=$ZONE ENGINE=$ENGINE DB=$DB UNIT=$UNIT ITS=$ITS HEAD=$(git -C "$W" rev-parse --short HEAD) DIRTY=$(git -C "$W" status --porcelain | wc -l | tr -d ' ')" > "$OUT/meta.txt"
TZ=$ZONE mvn "${ARGS[@]}" "$@" verify > "$OUT/mvn.log" 2>&1
RC=$?
echo "MVN_RC=$RC" >> "$OUT/meta.txt"
cp -R target/surefire-reports "$OUT/" 2>/dev/null; cp -R target/failsafe-reports "$OUT/" 2>/dev/null
grep -E "Tests run:.*Fail|BUILD|ERROR\]" "$OUT/mvn.log" | grep -v -E "^\[INFO\] Tests run: [0-9]+, Failures: 0, Errors: 0, Skipped: 0, Time" | tail -25 >> "$OUT/meta.txt"
echo "RESULT rc=$RC" >> "$OUT/meta.txt"
