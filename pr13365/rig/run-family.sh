#!/bin/bash
# Usage: run-family.sh <arm> <parallelism> : all Hosted*IT classes in one fork, like CI
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/82bd70be-da86-4042-ac1d-b63b9f729043/scratchpad
ARM=$1; PAR=$2
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd $SP/wt-$ARM || exit 2
DB="p13365_family_${ARM}_p${PAR}_$(date +%H%M%S)"
LOG=$SP/hh/family-$ARM-p$PAR.log
echo "arm=$ARM par=$PAR head=$(git rev-parse --short HEAD) db=$DB" > $LOG
mvn -B -o -Dmaven.repo.local=$SP/m2/repository -Phosted-harness-mysql -Dfailsafe.runOrder=alphabetical \
  "-DargLine=-Djdk.virtualThreadScheduler.parallelism=$PAR" \
  -Dtest=NoSuchTestPlease -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip \
  -Dnode.executable="$(command -v node)" -Dqwen.cli.entry=$SP/wt-pr/dist/cli.js \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:13365/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -f packages/sdk-java/managed-agent-server/pom.xml verify >> $LOG 2>&1
echo "exit=$?" >> $LOG
echo "$(date +%H:%M:%S) family $ARM par=$PAR: $(grep -a -E '^\[(INFO|ERROR|WARNING)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $LOG | tail -1) $(grep -a '<<< FAIL' $LOG | sed 's/.*-- in //' | tr '\n' ' ') $(tail -1 $LOG)"
