#!/bin/bash
# Build the round-2 comment's mutant set (its own generator mutants66.py, imported read-only) from <tree>, run each with host JDK 21, 6 at a time.
# usage: GEN=<round-2 harness/mutants66.py> run_round2_mutants.sh <tree-root> <outdir>
set -u
TREE=$1; OUT=$2
SRC=$OUT/src; rm -rf $OUT; mkdir -p $SRC
cp -r $TREE/packages/sdk-java/runtime-broker $SRC/ && rm -rf $SRC/runtime-broker/target
PYTHONDONTWRITEBYTECODE=1 python3 "${GEN:?set GEN to harness/mutants66.py of the round-2 evidence}" $SRC $OUT/m | tail -1
run() {
  d=$1
  (cd $d/runtime-broker && JAVA_HOME=${JAVA_HOME:?JDK 21} PATH=$JAVA_HOME/bin:$PATH ${MVN:-mvn} -o -q -B -Djacoco.skip=true test -Dtest=JdbcRepositoryTest,InMemoryRepositoryTest,RuntimeBrokerServiceTest -Dsurefire.failIfNoSpecifiedTests=false > ../suite.log 2>&1; echo $? > ../suite.exit)
  rm -rf $d/runtime-broker/target
}
export -f run
ls -d $OUT/m/*/ | xargs -P 6 -I{} bash -c 'run {}'
python3 - "$OUT" <<'PY'
import json, os, re, sys
out = sys.argv[1]
idx = json.load(open(f'{out}/m/index.json'))
killed = []
for mid, desc in idx:
    code = open(f'{out}/m/{mid}/suite.exit').read().strip()
    log = open(f'{out}/m/{mid}/suite.log').read()
    failed = re.search(r'Tests run:.*(Failures: [1-9]|Errors: [1-9])', log)
    status = 'KILLED' if code != '0' and failed else ('INFRA' if code != '0' else 'SURVIVED')
    if code != '0' and 'COMPILATION ERROR' in log:
        status = 'INFRA(compile)'
    print(f'{mid:<5} {status:<15} {desc}')
    if status == 'KILLED':
        killed.append(mid)
print(f'killed {len(killed)}/{len(idx)}')
PY
