#!/bin/bash
# usage: run-mutant.sh <tag> <mutant|none> <src module: runtime-broker|rb-oldc|rb-bshim>
#   copies the module inside the head tree, applies the mutant, then runs:
#   H2 unit suite + MySQL IT (clean verify), MySQL IT with
#   sendFractionalSeconds=false, and MariaDB 10.11 IT; fresh database per lane.
S=${WORKDIR:?set WORKDIR to the scratch directory}
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
TAG=$1; MUT=$2; SRC=${3:-runtime-broker}
MY=$HOME/Install/mysql-8.4.7-macos15-arm64/bin/mysql
V="${S:?}/head/packages/sdk-java/mut-${TAG:?}"
rm -rf "${V:?}"
cp -Rc "$S/head/packages/sdk-java/$SRC" "$V"; rm -rf "${V:?}/target"
if [ "$MUT" != none ]; then python3 $S/probe/mutants.py "$V" "$MUT" > $S/logs/mut-$TAG.apply 2>&1 || { echo "$TAG apply failed"; cat $S/logs/mut-$TAG.apply; exit 1; }; fi
DB=m_$(echo $TAG | tr 'A-Z-' 'a-z_')
$MY -uroot -h127.0.0.1 -P23788 -e "DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; DROP DATABASE IF EXISTS ${DB}_nf; CREATE DATABASE ${DB}_nf;"
docker exec pr12788r2-mariadb mariadb -uroot -pruntime-broker -e "DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB};"
URL="jdbc:mysql://127.0.0.1:23788/${DB}?allowPublicKeyRetrieval=true&useSSL=false"
MURL="jdbc:mysql://127.0.0.1:23789/${DB}?allowPublicKeyRetrieval=true&useSSL=false"
$S/mvn21.sh "$V" -Pmysql-integration clean verify -Djacoco.skip=true -Dmaven.test.failure.ignore=true \
  "-Dmysql.url=$URL" -Dmysql.user=root -Dmysql.password= > $S/logs/mut-$TAG-a.log 2>&1
mkdir -p "$V/reports-a"; cp -R "$V/target/surefire-reports" "$V/target/failsafe-reports" "$V/reports-a/" 2>/dev/null
rm -rf "${V:?}/target/failsafe-reports"
$S/mvn21.sh "$V" -Pmysql-integration test-compile failsafe:integration-test failsafe:verify -Djacoco.skip=true -Dmaven.test.failure.ignore=true \
  "-Dmysql.url=${URL/$DB/${DB}_nf}&sendFractionalSeconds=false" -Dmysql.user=root -Dmysql.password= > $S/logs/mut-$TAG-nf.log 2>&1
mkdir -p "$V/reports-nf"; cp -R "$V/target/failsafe-reports" "$V/reports-nf/" 2>/dev/null
rm -rf "${V:?}/target/failsafe-reports"
$S/mvn21.sh "$V" -Pmysql-integration test-compile failsafe:integration-test failsafe:verify -Djacoco.skip=true -Dmaven.test.failure.ignore=true \
  "-Dmysql.url=$MURL" -Dmysql.user=root -Dmysql.password=runtime-broker > $S/logs/mut-$TAG-mdb.log 2>&1
mkdir -p "$V/reports-mdb"; cp -R "$V/target/failsafe-reports" "$V/reports-mdb/" 2>/dev/null
# the lane really ran only if its database now has the broker tables
T_MY=$($MY -uroot -h127.0.0.1 -P23788 -N -e "select count(*) from information_schema.tables where table_schema in ('${DB}','${DB}_nf') group by table_schema order by table_schema" | tr '\n' ',')
T_MDB=$(docker exec pr12788r2-mariadb mariadb -uroot -pruntime-broker -N -e "select count(*) from information_schema.tables where table_schema='${DB}'" 2>/dev/null)
python3 - "$V" "$TAG" "$MUT" "$SRC" "$T_MY" "$T_MDB" >> $S/logs/mutation-results.txt <<'PY'
import sys, glob, xml.etree.ElementTree as ET
v, tag, mut, src, tmy, tmdb = sys.argv[1:7]
def scan(pattern):
    total = 0; failed = []; msgs = {}
    for f in glob.glob(pattern):
        r = ET.parse(f).getroot()
        for c in r.iter('testcase'):
            total += 1
            bad = c.find('failure') if c.find('failure') is not None else c.find('error')
            if bad is not None:
                name = c.get('classname').split('.')[-1] + '#' + c.get('name')
                failed.append(name)
                msgs[name] = (bad.get('message') or '').splitlines()[0][:160] if bad.get('message') else bad.get('type')
    return total, failed, msgs
u = scan(v + '/reports-a/surefire-reports/TEST-*.xml')
it = scan(v + '/reports-a/failsafe-reports/TEST-*.xml')
nf = scan(v + '/reports-nf/failsafe-reports/TEST-*.xml')
mdb = scan(v + '/reports-mdb/failsafe-reports/TEST-*.xml')
def fmt(x): return f"{x[0]-len(x[1])}/{x[0]}" + (" FAIL[" + ",".join(sorted(set(x[1]))) + "]" if x[1] else "")
print(f"{tag} src={src} mut={mut} | h2-unit {fmt(u)} | mysql-IT {fmt(it)} | nofrac-IT {fmt(nf)} | mariadb-IT {fmt(mdb)} | tables my={tmy} mdb={tmdb}")
for lane, x in (('h2', u), ('mysql', it), ('nofrac', nf), ('mariadb', mdb)):
    for k, m in x[2].items():
        print(f"    {tag} {lane} {k}: {m}")
PY
grep "^$TAG " $S/logs/mutation-results.txt | tail -1
