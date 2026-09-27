# usage: arm.sh <name> <job-script>   (EXTRA_MAVEN_ARGS / SKIP_INSTALL from env)
set -u
name=$1 job=$2
export JAVA_HOME=$HOME/Install/jdk21
export PATH=$JAVA_HOME/bin:$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
docker exec pr12864-mariadb mariadb -uroot -pruntime-broker -e 'DROP DATABASE IF EXISTS runtime_broker_test; DROP DATABASE IF EXISTS managed_agent_test; CREATE DATABASE runtime_broker_test;'
docker exec pr12864-mysql mysql -uroot -phosted-fixture -e 'DROP DATABASE IF EXISTS hosted_harness_test; CREATE DATABASE hosted_harness_test;' 2>/dev/null
log=$SP/java/logs/$name.log
{
  echo "::arm:: $name job=$(basename "$job") EXTRA_MAVEN_ARGS=${EXTRA_MAVEN_ARGS:-} SKIP_INSTALL=${SKIP_INSTALL:-}"
  echo "::tree:: $(cd "$WT" && git rev-parse --short HEAD) dirty: $(cd "$WT" && git status --short | tr '\n' ' ')"
  java -version 2>&1 | head -1; mvn -v 2>&1 | head -1; node -v
  bash "$job"
} > "$log" 2>&1
rc=$?
for m in runtime-broker managed-agent-server; do
  d=$WT/packages/sdk-java/$m/target/failsafe-reports
  [ -d "$d" ] && mkdir -p "$SP/java/reports/$name/$m" && cp "$d"/*.xml "$SP/java/reports/$name/$m/" 2>/dev/null
done
grep -E '^::(arm|tree|step-result|job-result)::|Tests run:.*Fail|::error::|ran [0-9]+ test|BUILD (SUCCESS|FAILURE)' "$log" | grep -v '^\[INFO\] Tests run:.*, Time elapsed' 
exit $rc
