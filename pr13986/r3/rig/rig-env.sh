# PR 13986 rig — shared environment (derived from the H3 acceptance rig).
# Arms: ARM_JAR picks server/<arm>.jar (Spring + embedded Broker + workers'
# provisioner), HARNESS_DIST picks dist-<arm> for the Harness daemon,
# WORKER_DIST picks dist-<arm> for provisioned Runtime workers.
RIG=/root/pr13986-rig
ARM_JAR=${ARM_JAR:-pr}
HARNESS_DIST=${HARNESS_DIST:-pr}
WORKER_DIST=${WORKER_DIST:-$HARNESS_DIST}
OUT=$RIG/out
LOGS=$RIG/logs
STATE_DIR=$RIG/runtime-state
WORKSPACE=$RIG/workspace
MOUNTS=$RIG/mounts
HOME_JAVA=$RIG/home-java
HOME_HARNESS=$RIG/home-harness
CGROUP_ROOT=/sys/fs/cgroup/qwen-pr13986

DB_SOCKET=$RIG/db/s.sock
DB_PORT=13986
DB_NAME=${DB_NAME:-q13986v3}
DB_PASS=r13986

SPRING_PORT=18986
BROKER_PORT=18987
HARNESS_PORT=18988
PROXY_PORT=18989
FAKE_PORT=19986
OSS_PORT=41986
# The Harness reaches the Broker directly unless a scenario routes it
# through the fault proxy (bproxy.mjs) with HARNESS_VIA_PROXY=1.
if [ "${HARNESS_VIA_PROXY:-0}" = 1 ]; then
  HARNESS_BROKER_URL=http://127.0.0.1:$PROXY_PORT
else
  HARNESS_BROKER_URL=http://127.0.0.1:$BROKER_PORT
fi

TENANT=t-13986
STORAGES="a b c d"
ACTOR=rig-actor
ACTOR_HEADER=X-Rig-Actor
WORKSPACE_RUNTIME_ID=$(printf %s "$WORKSPACE" | sha256sum | cut -c1-16)

HARNESS_TOKEN=$(cat $RIG/secrets/harness-token 2>/dev/null)
BROKER_TOKEN=$(cat $RIG/secrets/broker-token 2>/dev/null)

JAVA=$RIG/jdk21/bin/java
SERVER_JAR=$RIG/server/$ARM_JAR.jar
CLI=$RIG/dist-$HARNESS_DIST/cli.js
WORKER_CLI=$RIG/dist-$WORKER_DIST/cli.js
NODE_BIN=$(command -v node)

sql() { mysql --socket=$DB_SOCKET -uroot -p$DB_PASS -N -B $DB_NAME -e "$1"; }
sql_db() { mysql --socket=$DB_SOCKET -uroot -p$DB_PASS -N -B -e "$1"; }

wait_url() { # wait_url <name> <url> <tries>
  local name=$1 url=$2 tries=${3:-60} i
  for i in $(seq 1 $tries); do
    curl -sf -o /dev/null --max-time 3 "$url" && return 0
    sleep 1
  done
  echo "TIMEOUT waiting for $name ($url)" >&2
  return 1
}

# PIDs of this rig's own service processes only (never pattern-kill other rigs).
rig_pids() {
  ps -eo pid=,args= | awk -v me=$$ '
    $1 != me && ($0 ~ /\/root\/pr13986-rig\/(dist-|server\/|repo-fake-model|oss-shim|bproxy)/) { print $1 }'
}
