#!/bin/bash
# HostedPublicWorkspaceIT alone, through failsafe, with surefire skipped (the unit lane is measured separately).
# usage: it.sh <worktree> <label> <db: mysql|mariadb|h2> [extra mvn args...]
#   env: CLI=<dist dir label, default head>  NODE=<node executable, default real Node 22>  M2=<m2 dir, default m2>
set -u
. /Users/wenshao/pr13095-rig/scripts/env.sh
W=$RIG/$1; L=$2; DB=$3; shift 3
O=$RIG/out/it; mkdir -p $O
NODE=${NODE:-/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node}
CLI=${CLI:-$RIG/wt/dist/cli.js}; M2=${M2:-m2}
DBN=g0_$(echo $L | tr -c 'a-zA-Z0-9\n' '_')_$(date +%s)
case "$DB" in
  mysql)   DBARGS=("-Dmysql.url=jdbc:mysql://127.0.0.1:$MYSQL_PORT/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig13095);;
  mariadb) DBARGS=("-Dmysql.url=jdbc:mysql://127.0.0.1:33195/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig13095);;
  h2)      DBARGS=();;
esac
S=$(date +%s)
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$RIG/$M2 -f $W/packages/sdk-java/managed-agent-server/pom.xml \
  -Phosted-harness-mysql -Dtest=NoUnitTestsInThisLane -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedPublicWorkspaceIT \
  "-Dnode.executable=$NODE" "-Dqwen.cli.entry=$CLI" ${DBARGS[@]+"${DBARGS[@]}"} "$@" verify > $O/$L.log 2>&1
RC=$?
T=$(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+.*HostedPublicWorkspaceIT' $O/$L.log | tail -1 | sed -E 's/^\[[A-Z]+\] //; s/ <<<.*//')
echo "RESULT it $L db=$DB exit=$RC ${T:-no-totals} wall=$(( $(date +%s) - S ))s dbname=$DBN tree=$(git -C $W rev-parse --short HEAD)"
grep -E 'HostedPublicWorkspaceIT\.[a-zA-Z]+:[0-9]+|^(expected|  but was| but was|Expecting)' $O/$L.log | sort -u | cut -c1-260 | head -8 | sed 's/^/   /'
