#!/bin/bash
# pr13335 rig launcher.
#   stack.sh up <arm> <tag> [K=V ...]   start Spring(<arm>.jar)+Hosted Harness; K=V are extra Spring env
#   stack.sh spring <arm> <tag> [K=V ...] start Spring only (boot probes), waits for health or exit
#   stack.sh down <tag>                  stop by recorded PIDs (and their descendants)
# Env knobs: SPRING_PORT HARNESS_PORT BROKER_PORT NO_CLI_ENTRY=1 NO_HARNESS=1 KEEP_DB=1
set -u
R=/Users/wenshao/pr13335-rig
MYSQL=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql
JAVA=/Users/wenshao/Install/zulu21.52.15-ca-jdk21.0.12-macosx_aarch64/Contents/Home/bin/java
NODE=$(command -v node)
CLI=$R/src-merge/dist/cli.js
FAKE=http://127.0.0.1:18400/v1

kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}

cmd=$1; shift
case "$cmd" in
down)
  tag=$1; RUN=$R/runs/$tag
  for f in harness.pid spring.pid; do
    [ -f "$RUN/$f" ] || continue
    pid=$(cat "$RUN/$f")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill_tree "$pid"; fi
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    rm -f "$RUN/$f"
  done
  echo "down $tag"
  exit 0 ;;
up|spring) ;;
*) echo "bad cmd"; exit 2 ;;
esac

arm=$1; tag=$2; shift 2
case "$arm" in base) off=1 ;; merge|merge2|cand) off=11 ;; *) echo "bad arm"; exit 2 ;; esac
SPRING_PORT=${SPRING_PORT:-$((18400 + off))}
HARNESS_PORT=${HARNESS_PORT:-$((18400 + off + 1))}
BROKER_PORT=${BROKER_PORT:-$((18400 + off + 2))}
RUN=$R/runs/$tag
mkdir -p "$RUN"/{workspace,workspace-mount,harness-home/.qwen,runtime-home/.qwen}
mkdir -p -m 700 "$RUN/runtime-state"
echo '{"ui":{"enableFollowupSuggestions":false}}' > "$RUN/harness-home/.qwen/settings.json"
echo '{"ui":{"enableFollowupSuggestions":false}}' > "$RUN/runtime-home/.qwen/settings.json"
printf '{"%s":"TRUST_FOLDER"}' "$RUN/workspace" > "$RUN/trusted-folders.json"
chmod 600 "$RUN"/harness-home/.qwen/settings.json "$RUN"/runtime-home/.qwen/settings.json "$RUN/trusted-folders.json"
HARNESS_TOKEN=$(openssl rand -hex 24); BROKER_TOKEN=$(openssl rand -hex 24)
CRED_KEY=$(openssl rand -base64 32); DIGEST="sha256:$(openssl rand -hex 32)"
WS_DIR="$RUN/workspace"
if [ -n "${REUSE:-}" ]; then
  # Second Spring on the first run's DB, Harness, workspace identity and secrets.
  source "$R/runs/$REUSE/secrets.env"
  KEEP_DB=1; NO_HARNESS=1
else
  DB=q13335_$(echo "$tag" | tr -c 'a-zA-Z0-9\n' '_')
fi
WORKSPACE_ID=$(printf '%s' "$WS_DIR" | shasum -a 256 | cut -c1-16)
( umask 077; printf 'HARNESS_TOKEN=%s\nCRED_KEY=%s\nDIGEST=%s\nDB=%s\nHARNESS_PORT=%s\nWS_DIR=%s\n' \
  "$HARNESS_TOKEN" "$CRED_KEY" "$DIGEST" "$DB" "$HARNESS_PORT" "$WS_DIR" > "$RUN/secrets.env" )
if [ "${KEEP_DB:-0}" != 1 ]; then
  $MYSQL -uroot -S $R/my/mysql.sock -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
fi
cat > "$RUN/meta.env" <<EOF
ARM=$arm
TAG=$tag
DB=$DB
SPRING=http://127.0.0.1:$SPRING_PORT
HARNESS=http://127.0.0.1:$HARNESS_PORT
BROKER_PORT=$BROKER_PORT
EOF

base_env=(PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME="$RUN/runtime-home" LANG=C LC_ALL=C TZ=UTC
  NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost TMPDIR="$RUN")
spring_env=("${base_env[@]}"
  QWEN_HOME="$RUN/runtime-home/.qwen"
  SERVER_PORT=$SPRING_PORT
  SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33335/$DB?useSSL=false&allowPublicKeyRetrieval=true"
  SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=
  MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE=health,info,configprops
  MANAGEMENT_ENDPOINT_CONFIGPROPS_SHOW_VALUES=always
  QWEN_MANAGED_AGENT_APPROVAL_MODE=yolo
  QWEN_MANAGED_AGENT_CAPABILITY_DIGEST=$DIGEST
  QWEN_MANAGED_AGENT_HARNESS_BASE_URL=http://127.0.0.1:$HARNESS_PORT
  QWEN_MANAGED_AGENT_HARNESS_ENABLED=true
  QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT=120s
  QWEN_MANAGED_AGENT_HARNESS_TOKEN=$HARNESS_TOKEN
  QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY=false
  QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER=x-qwen-e2e-trusted-actor
  QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED=true
  QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS=false
  QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED=true
  QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT=$BROKER_PORT
  QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN=$BROKER_TOKEN
  QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY=$CRED_KEY
  QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID=e2e-local-v1
  QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY="$RUN/runtime-state"
  QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY=$CLI
  QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL=http://127.0.0.1:$SPRING_PORT
  QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true
  QWEN_MANAGED_AGENT_WORKSPACE_ID=$WORKSPACE_ID
  QWEN_MANAGED_AGENT_NODE_EXECUTABLE=$NODE
  QWEN_MANAGED_AGENT_WORKSPACE_CWD="$WS_DIR")
[ "${NO_CLI_ENTRY:-0}" = 1 ] || spring_env+=(QWEN_MANAGED_AGENT_CLI_ENTRY=$CLI)
spring_env+=("$@")
printf '%s\n' "${spring_env[@]}" | grep -v -E 'TOKEN|CREDENTIAL_KEY=' > "$RUN/spring.env.txt"

: > "$RUN/spring.log"
env -i "${spring_env[@]}" "$JAVA" -jar "$R/jars/$arm.jar" \
  "--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=pr13335" \
  "--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=e2e-storage" \
  "--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=$RUN/workspace-mount" \
  >> "$RUN/spring.log" 2>&1 &
SPID=$!
echo $SPID > "$RUN/spring.pid"
ok=0
for _ in $(seq 1 240); do
  if ! kill -0 $SPID 2>/dev/null; then break; fi
  if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SPRING_PORT/actuator/health" 2>/dev/null | grep -q 200; then ok=1; break; fi
  sleep 0.5
done
if [ $ok != 1 ]; then
  wait $SPID 2>/dev/null; code=$?
  echo "SPRING_BOOT=FAILED exit=$code arm=$arm tag=$tag"
  rm -f "$RUN/spring.pid"
  exit 1
fi
echo "SPRING_BOOT=OK arm=$arm tag=$tag pid=$SPID port=$SPRING_PORT"
[ "$cmd" = spring ] && exit 0
[ "${NO_HARNESS:-0}" = 1 ] && exit 0

: > "$RUN/harness.log"
env -i "${base_env[@]}" PATH="$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin" HOME="$RUN/harness-home" \
  QWEN_HOME="$RUN/harness-home/.qwen" QWEN_CODE_TRUSTED_FOLDERS_PATH="$RUN/trusted-folders.json" \
  QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=$DIGEST QWEN_SERVER_TOKEN=$HARNESS_TOKEN \
  OPENAI_API_KEY=fake-key OPENAI_BASE_URL=$FAKE OPENAI_MODEL=fake-model QWEN_MODEL=fake-model \
  QWEN_RUNTIME_BROKER_TOKEN=$BROKER_TOKEN QWEN_RUNTIME_BROKER_URL=http://127.0.0.1:$BROKER_PORT \
  "$NODE" "$CLI" serve --profile hosted-harness --port $HARNESS_PORT --hostname 127.0.0.1 \
  --require-auth --no-web --workspace "$RUN/workspace" \
  --managed-runtime-broker-url http://127.0.0.1:$BROKER_PORT \
  "--managed-runtime-broker-token=$BROKER_TOKEN" >> "$RUN/harness.log" 2>&1 &
HPID=$!
echo $HPID > "$RUN/harness.pid"
for _ in $(seq 1 120); do
  kill -0 $HPID 2>/dev/null || { echo "HARNESS=DIED"; exit 1; }
  if curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $HARNESS_TOKEN" "http://127.0.0.1:$HARNESS_PORT/health" | grep -q 200; then
    echo "HARNESS=OK pid=$HPID port=$HARNESS_PORT"; exit 0
  fi
  sleep 0.5
done
echo "HARNESS=TIMEOUT"; exit 1
