#!/bin/bash
# Hosted IT lane on the rig's native MySQL 8.4.7. usage: it.sh <worktree> <label> <m2> [IT class] [extra mvn args...]
set -u
RIG=/Users/wenshao/pr13112-rig; export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
W=$RIG/$1; L=$2; M2=$RIG/$3; IT=${4:-HostedPublicWorkspaceIT}; shift 4 2>/dev/null || shift $#
O=$RIG/out/it; mkdir -p $O
NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
CLI=${CLI:-$RIG/dist/head/cli.js}
DBN=it_$(echo $L | tr -c 'a-zA-Z0-9\n' '_')_$(date +%s)
S=$(date +%s)
mvn --batch-mode --no-transfer-progress -o -Dmaven.repo.local=$M2 -f $W/packages/sdk-java/managed-agent-server/pom.xml \
  -Phosted-harness-mysql -Dtest=NoUnitTestsInThisLane -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=$IT \
  "-Dnode.executable=$NODE" "-Dqwen.cli.entry=$CLI" \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33112/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rig13112 \
  "$@" verify > $O/$L.log 2>&1
RC=$?
T=$(grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+.*$IT" $O/$L.log | tail -1 | sed -E 's/^\[[A-Z]+\] //; s/ <<<.*//')
echo "RESULT it $L exit=$RC ${T:-no-totals} wall=$(( $(date +%s) - S ))s dbname=$DBN tree=$(git -C $W rev-parse --short HEAD) cli=$CLI"
