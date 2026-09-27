set -u
cd '<scratch>/wt-pr'
export GITHUB_WORKSPACE='<scratch>/wt-pr'
JOB_RC=0
if [ -n "${SKIP_INSTALL:-}" ]; then echo "::step-result:: (install skipped, done in an earlier arm)"; else echo "::step:: Install Managed Agent dependencies"; T0=$(date +%s)
( cd '.' && export MAVEN_ARGS='--settings <scratch>/settings.xml -Dmaven.repo.local=<scratch>/m2repo'"${EXTRA_MAVEN_ARGS:+ }${EXTRA_MAVEN_ARGS:-}" && true && bash --noprofile --norc -eo pipefail '<scratch>/java/hosted-pr.step1.sh' )
RC=$?; echo "::step-result:: Install Managed Agent dependencies exit=$RC secs=$(( $(date +%s) - T0 ))"; [ $RC -ne 0 ] && JOB_RC=$RC; fi
echo "::step:: Verify Hosted Java, Spring and MySQL processes"; T0=$(date +%s)
( cd '.' && export MAVEN_ARGS='--settings <scratch>/settings.xml -Dmaven.repo.local=<scratch>/m2repo'"${EXTRA_MAVEN_ARGS:+ }${EXTRA_MAVEN_ARGS:-}" && export MYSQL_PORT='23865' && true && bash --noprofile --norc -eo pipefail '<scratch>/java/hosted-noclean.step2.sh' )
RC=$?; echo "::step-result:: Verify Hosted Java, Spring and MySQL processes exit=$RC secs=$(( $(date +%s) - T0 ))"; [ $RC -ne 0 ] && JOB_RC=$RC
echo "::step:: Check that every Hosted integration test class ran"; T0=$(date +%s)
( cd '.' && true && bash --noprofile --norc -eo pipefail '<scratch>/java/hosted-pr.step3.sh' )
RC=$?; echo "::step-result:: Check that every Hosted integration test class ran exit=$RC secs=$(( $(date +%s) - T0 ))"; [ $RC -ne 0 ] && JOB_RC=$RC
echo "::job-result:: exit=$JOB_RC"
exit $JOB_RC
