#!/bin/bash
# usage: run-mutant.sh <tag> <mutant|none> [candidate]
#   builds head runtime-broker copy, applies mutant, optionally adds the
#   candidate contract test, then runs: H2 unit suite + MySQL IT (default)
#   and MySQL IT with sendFractionalSeconds=false. Writes a summary line.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/2f81e323-488e-421e-ab76-882360719f9e/scratchpad
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
TAG=$1; MUT=$2; CAND=${3:-}
MY=$HOME/Install/mysql-8.4.7-macos15-arm64/bin/mysql
V="${S:?}/head/packages/sdk-java/mut-${TAG:?}"
rm -rf "${V:?}"
cp -Rc "$S/head/packages/sdk-java/runtime-broker" "$V"; rm -rf "${V:?}/target"
[ "$MUT" != none ] && python3 $S/probe/mutants.py "$V" "$MUT" > $S/logs/mut-$TAG.apply 2>&1
if [ -n "$CAND" ]; then patch -s -d "$V" -p1 < $S/probe/candidate.patch || { echo "$TAG patch failed"; exit 1; }; fi
DB=m_$(echo $TAG | tr 'A-Z-' 'a-z_')
$MY -uroot -h127.0.0.1 -P13788 -e "DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; DROP DATABASE IF EXISTS ${DB}_nf; CREATE DATABASE ${DB}_nf;"
URL="jdbc:mysql://127.0.0.1:13788/${DB}?allowPublicKeyRetrieval=true&useSSL=false"
$S/mvn21.sh "$V" -Pmysql-integration clean verify -Djacoco.skip=true -Dmaven.test.failure.ignore=true \
  "-Dmysql.url=$URL" -Dmysql.user=root -Dmysql.password= > $S/logs/mut-$TAG-a.log 2>&1
mkdir -p "$V/reports-a"; cp -R "$V/target/surefire-reports" "$V/target/failsafe-reports" "$V/reports-a/" 2>/dev/null
rm -rf "${V:?}/target/failsafe-reports"
$S/mvn21.sh "$V" -Pmysql-integration test-compile failsafe:integration-test failsafe:verify -Djacoco.skip=true -Dmaven.test.failure.ignore=true \
  "-Dmysql.url=${URL/$DB/${DB}_nf}&sendFractionalSeconds=false" -Dmysql.user=root -Dmysql.password= > $S/logs/mut-$TAG-nf.log 2>&1
mkdir -p "$V/reports-nf"; cp -R "$V/target/failsafe-reports" "$V/reports-nf/" 2>/dev/null
python3 - "$V" "$TAG" "$MUT" "$CAND" >> $S/logs/mutation-results.txt <<'PY'
import sys, glob, xml.etree.ElementTree as ET
v, tag, mut, cand = sys.argv[1:5]
def scan(pattern):
    total = 0; failed = []
    for f in glob.glob(pattern):
        r = ET.parse(f).getroot()
        for c in r.iter('testcase'):
            total += 1
            if c.find('failure') is not None or c.find('error') is not None:
                failed.append(c.get('classname').split('.')[-1] + '#' + c.get('name'))
    return total, failed
u = scan(v + '/reports-a/surefire-reports/TEST-*.xml')
it = scan(v + '/reports-a/failsafe-reports/TEST-*.xml')
nf = scan(v + '/reports-nf/failsafe-reports/TEST-*.xml')
def fmt(x): return f"{x[0]-len(x[1])}/{x[0]}" + (" FAIL[" + ",".join(sorted(set(x[1]))) + "]" if x[1] else "")
print(f"{tag} mut={mut} cand={'y' if cand else 'n'} | h2-unit {fmt(u)} | mysql-IT {fmt(it)} | mysql-nofrac-IT {fmt(nf)}")
PY
tail -1 $S/logs/mutation-results.txt
