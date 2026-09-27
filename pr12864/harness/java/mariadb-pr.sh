set -u
cd '<scratch>/wt-pr'
export GITHUB_WORKSPACE='<scratch>/wt-pr'
JOB_RC=0
echo "::step:: Run Runtime Broker MySQL integration tests"; T0=$(date +%s)
( cd 'packages/sdk-java/runtime-broker' && export MAVEN_ARGS='--settings <scratch>/settings.xml -Dmaven.repo.local=<scratch>/m2repo'"${EXTRA_MAVEN_ARGS:+ }${EXTRA_MAVEN_ARGS:-}" && true && bash --noprofile --norc -eo pipefail '<scratch>/java/mariadb-pr.step1.sh' )
RC=$?; echo "::step-result:: Run Runtime Broker MySQL integration tests exit=$RC secs=$(( $(date +%s) - T0 ))"; [ $RC -ne 0 ] && JOB_RC=$RC
if [ -n "${SKIP_INSTALL:-}" ]; then echo "::step-result:: (install skipped, done in an earlier arm)"; else echo "::step:: Install Managed Agent dependencies"; T0=$(date +%s)
( cd '.' && export MAVEN_ARGS='--settings <scratch>/settings.xml -Dmaven.repo.local=<scratch>/m2repo'"${EXTRA_MAVEN_ARGS:+ }${EXTRA_MAVEN_ARGS:-}" && true && bash --noprofile --norc -eo pipefail '<scratch>/java/mariadb-pr.step2.sh' )
RC=$?; echo "::step-result:: Install Managed Agent dependencies exit=$RC secs=$(( $(date +%s) - T0 ))"; [ $RC -ne 0 ] && JOB_RC=$RC; fi
echo "::step:: Run Managed Agent tests, Checkstyle, and MySQL integration"; T0=$(date +%s)
( cd 'packages/sdk-java/managed-agent-server' && export MAVEN_ARGS='--settings <scratch>/settings.xml -Dmaven.repo.local=<scratch>/m2repo'"${EXTRA_MAVEN_ARGS:+ }${EXTRA_MAVEN_ARGS:-}" && true && bash --noprofile --norc -eo pipefail '<scratch>/java/mariadb-pr.step3.sh' )
RC=$?; echo "::step-result:: Run Managed Agent tests, Checkstyle, and MySQL integration exit=$RC secs=$(( $(date +%s) - T0 ))"; [ $RC -ne 0 ] && JOB_RC=$RC
echo "::step:: Check that every non-Hosted integration test class ran"; T0=$(date +%s)
( cd '.' && true && bash --noprofile --norc -eo pipefail '<scratch>/java/mariadb-pr.step4.sh' )
RC=$?; echo "::step-result:: Check that every non-Hosted integration test class ran exit=$RC secs=$(( $(date +%s) - T0 ))"; [ $RC -ne 0 ] && JOB_RC=$RC
echo "::job-result:: exit=$JOB_RC"
exit $JOB_RC
