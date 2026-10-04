#!/bin/bash
# Usage: run-hh.sh <arm> <alone|after-burst> <rep> [parallelism]
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/82bd70be-da86-4042-ac1d-b63b9f729043/scratchpad
ARM=$1; MODE=$2; REP=$3; PAR=${4:-4}
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd $SP/wt-$ARM || exit 2
if [ "$MODE" = alone ]; then ITS=HostedHarnessMySqlIT; else ITS=HostedConcurrentTurnBurstMySqlIT,HostedHarnessMySqlIT; fi
DB="p13365_hh_${ARM}_${MODE//-/_}_r${REP}_$(date +%H%M%S)"
LOG=$SP/hh/$ARM-$MODE-p$PAR-r$REP.log
echo "arm=$ARM mode=$MODE par=$PAR head=$(git rev-parse --short HEAD) db=$DB" > $LOG
mvn -B -o -Dmaven.repo.local=$SP/m2/repository -Phosted-harness-mysql -Dit.test=$ITS -Dfailsafe.runOrder=alphabetical \
  "-DargLine=-Djdk.virtualThreadScheduler.parallelism=$PAR" \
  -Dtest=NoSuchTestPlease -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip \
  -Dnode.executable="$(command -v node)" -Dqwen.cli.entry=$SP/wt-pr/dist/cli.js \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13365/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -f packages/sdk-java/managed-agent-server/pom.xml verify >> $LOG 2>&1
echo "exit=$?" >> $LOG
echo "$(date +%H:%M:%S) $ARM $MODE par=$PAR r$REP: $(grep -a -E 'Tests run:.*in com.alibaba.qwen.code.managedagent.HostedHarnessMySqlIT' $LOG | sed 's/.*Tests run/Tests run/' | cut -c1-80) $(grep -a -o 'Turn completion timed out' $LOG | head -1) $(tail -1 $LOG)"
