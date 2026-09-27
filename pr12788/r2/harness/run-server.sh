#!/bin/bash
# usage: M2=<repo> run-server.sh <tag> <server module dir name> <lane: h2flyway|mysql|mariadb|full-mariadb|full-mysql>
S=${WORKDIR:?set WORKDIR to the scratch directory}
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
TAG=$1; MOD=$2; L=$3
D=$S/head/packages/sdk-java/$MOD
DB=srv_$(echo $TAG | tr 'A-Z-' 'a-z_')_${L}_$(date +%H%M%S)
DB=$(echo $DB | tr '-' '_')
MY=$HOME/Install/mysql-8.4.7-macos15-arm64/bin/mysql
case $L in
  h2flyway) ARGS=(clean test -Dtest=RuntimeBrokerFlywaySchemaTest -Dsurefire.failIfNoSpecifiedTests=false) ;;
  mysql|full-mysql) $MY -uroot -h127.0.0.1 -P23788 -e "CREATE DATABASE $DB"
     URL="jdbc:mysql://127.0.0.1:23788/$DB?allowPublicKeyRetrieval=true&useSSL=false"; PW= ;;
  mariadb|full-mariadb) docker exec pr12788r2-mariadb mariadb -uroot -pruntime-broker -e "CREATE DATABASE $DB"
     URL="jdbc:mysql://127.0.0.1:23789/$DB?allowPublicKeyRetrieval=true&useSSL=false"; PW=runtime-broker ;;
esac
case $L in
  mysql|mariadb) ARGS=(-Pmysql-integration clean test-compile failsafe:integration-test failsafe:verify -Dit.test=ManagedAgentMySqlIT "-Dmysql.url=$URL" -Dmysql.user=root "-Dmysql.password=$PW") ;;
  full-*) ARGS=(-Pmysql-integration clean verify checkstyle:check "-Dmysql.url=$URL" -Dmysql.user=root "-Dmysql.password=$PW") ;;
esac
$S/mvn21.sh $D "${ARGS[@]}" -Dmaven.test.failure.ignore=true > $S/logs/srv-$TAG-$L.log 2>&1
RC=$?
python3 - "$D" "$TAG" "$L" "$RC" >> $S/logs/server-results.txt <<'PY'
import sys, glob, xml.etree.ElementTree as ET
d, tag, lane, rc = sys.argv[1:5]
out = []
for kind in ('surefire', 'failsafe'):
    total = 0; failed = {}
    for f in glob.glob(f"{d}/target/{kind}-reports/TEST-*.xml"):
        for c in ET.parse(f).getroot().iter('testcase'):
            total += 1
            bad = c.find('failure') if c.find('failure') is not None else c.find('error')
            if bad is not None:
                failed[c.get('classname').split('.')[-1] + '#' + c.get('name')] = ((bad.get('message') or bad.get('type') or '').splitlines() or [''])[0][:200]
    if total:
        out.append(f"{kind} {total-len(failed)}/{total}")
        for k, m in failed.items():
            out.append(f"\n    FAIL {k}: {m}")
print(f"{tag} {lane} mvn-exit={rc} | " + " ".join(out))
PY
grep "^$TAG $L " $S/logs/server-results.txt | tail -1
