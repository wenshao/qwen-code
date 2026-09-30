#!/bin/bash
# container (VM, --network host, run as the service account's uid; host /srv/w1a and /etc/machine-id bind-mounted):
# the README's W1a maintenance invocation, verbatim, from the module directory.
set -u
export HOME=/tmp/h; mkdir -p $HOME /tmp/r /tmp/m2
cp -a /rig/${SRC:-src-new}/. /tmp/r/; cp -a /root/.m2/repository/. /tmp/m2/ 2>/dev/null || cp -a /m2src/. /tmp/m2/
export MAVEN_ARGS="-Dmaven.repo.local=/tmp/m2"
DB=$1
echo "whoami: $(id -u):$(id -g)  machine-id=$(cat /etc/machine-id)  $(java -version 2>&1 | head -1)  $(mvn -v 2>/dev/null | head -1)"
(cd /tmp/r/packages/sdk-java/qwencode && mvn -B -ntp -q -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > /tmp/dep.log 2>&1); echo "sibling SDK install: exit=$?"
(cd /tmp/r/packages/sdk-java/runtime-broker && mvn -B -ntp -q -DskipTests -Dcheckstyle.skip=true install >> /tmp/dep.log 2>&1); echo "sibling Runtime Broker install: exit=$?"
cd /tmp/r/packages/sdk-java/managed-agent-server
export W1_JDBC_URL="jdbc:mysql://127.0.0.1:3306/$DB?allowPublicKeyRetrieval=true&useSSL=false" W1_JDBC_USER=root W1_JDBC_PASSWORD=rootpw
run() {
  echo; echo "\$ mvn -q -DskipTests compile exec:java -Dexec.mainClass=...WorkspaceStorageRegistrationMain -Dexec.args='$1'"
  local t0=$(date +%s)
  mvn -q -DskipTests compile exec:java \
    -Dexec.mainClass=com.alibaba.qwen.code.managedagent.store.WorkspaceStorageRegistrationMain \
    -Dexec.args="$1" > /tmp/out.log 2>&1
  local rc=$?
  echo "exit=$rc after $(( $(date +%s) - t0 )) s; output lines=$(wc -l < /tmp/out.log)"
  grep -v "^\s*at \|^WARNING\|^\[WARNING\]" /tmp/out.log | grep -v '^$' | cut -c1-230 | head -${2:-6}
}
OP=$(cat /proc/sys/kernel/random/uuid)
run "inspect t-w1a st-d /srv/w1a/d"
run "register t-w1a st-d /srv/w1a/d $OP --offline-confirmed"
run "inspect t-w1a st-d /srv/w1a/d"
run "register t-w1a st-d /srv/w1a/d $OP --offline-confirmed"
run "register t-w1a st-d /srv/w1a/d $(cat /proc/sys/kernel/random/uuid) --offline-confirmed" 8
run "fence t-w1a st-d /srv/w1a/d 1 $OP --offline-confirmed"
run "restore-original t-w1a st-d /srv/w1a/d 1 $OP --offline-confirmed"
run "inspect t-w1a st-d /srv/w1a/d"
ls -la /srv/w1a/d/ | sed 's/^/   /'
echo S10-DONE
