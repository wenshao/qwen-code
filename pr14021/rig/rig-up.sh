#!/bin/bash
# rig-up.sh [all|harness] — boot the chain: rig MariaDB (must be up) → OSS shim
# → managed-agent-server (Spring + embedded Broker + durable provisioner) →
# fake model → hosted-harness daemon. `harness` boots only the Harness (used
# after a scenario kills it). All production binaries; the only stand-ins are
# the LLM (scripted fake) and the OSS endpoint (local TLS shim).
set -u
cd "$(dirname "$0")"
source ./rig-env.sh
MODE=${1:-all}

mkdir -p "$OUT" "$LOGS" "$STATE_DIR" "$WORKSPACE" "$MOUNTS" "$HOME_JAVA/.qwen" "$HOME_HARNESS/.qwen" "$RIG/secrets" "$CGROUP_ROOT"
chmod 700 "$STATE_DIR" "$RIG/secrets"
find "$STATE_DIR" -type f -exec chmod 600 {} + 2>/dev/null || true
find "$RIG/secrets" -type f -exec chmod 600 {} + 2>/dev/null || true
for s in $STORAGES; do mkdir -p "$MOUNTS/st-$s"; done

[ -f "$RIG/secrets/harness-token" ] || openssl rand -base64 33 | tr -d '\n' > "$RIG/secrets/harness-token"
[ -f "$RIG/secrets/broker-token" ] || openssl rand -base64 33 | tr -d '\n' > "$RIG/secrets/broker-token"
[ -f "$RIG/secrets/credential-key" ] || openssl rand -base64 32 | tr -d '\n' > "$RIG/secrets/credential-key"
[ -f "$RIG/secrets/capability-digest" ] || printf 'sha256:%s' "$(openssl rand -hex 32)" > "$RIG/secrets/capability-digest"
HARNESS_TOKEN=$(cat "$RIG/secrets/harness-token")
BROKER_TOKEN=$(cat "$RIG/secrets/broker-token")
CREDENTIAL_KEY=$(cat "$RIG/secrets/credential-key")
CAPABILITY_DIGEST=$(cat "$RIG/secrets/capability-digest")
echo "$WORKSPACE" > "$RIG/secrets/trusted-folders"

start_harness() {
  if curl -sf -o /dev/null -H "authorization: Bearer $HARNESS_TOKEN" "http://127.0.0.1:$HARNESS_PORT/health"; then
    echo "harness already up"; return 0
  fi
  FAKE_URL=$(sed -n 's/^repo fake model on //p' "$LOGS/fake-model.log" | head -1)
  [ -n "$FAKE_URL" ] || { echo "fake model base url missing"; return 1; }
  local hl="$LOGS/harness-$(date +%H%M%S).log"
  env -i HOME="$HOME_HARNESS" LANG=C LC_ALL=C PATH=/usr/local/bin:/usr/bin:/bin \
    TMPDIR=/tmp \
    QWEN_HOME="$HOME_HARNESS/.qwen" \
    QWEN_CODE_TRUSTED_FOLDERS_PATH="$RIG/secrets/trusted-folders" \
    QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST="$CAPABILITY_DIGEST" \
    QWEN_SERVER_TOKEN="$HARNESS_TOKEN" \
    OPENAI_API_KEY=fake-key \
    OPENAI_BASE_URL="$FAKE_URL" \
    OPENAI_MODEL=fake-model \
    QWEN_MODEL=fake-model \
    QWEN_RUNTIME_BROKER_TOKEN="$BROKER_TOKEN" \
    QWEN_RUNTIME_BROKER_URL="$HARNESS_BROKER_URL" \
    "$NODE_BIN" "$CLI" serve --profile hosted-harness --port $HARNESS_PORT \
      --hostname 127.0.0.1 --require-auth --no-web --workspace "$WORKSPACE" \
      --managed-runtime-broker-url "$HARNESS_BROKER_URL" \
      "--managed-runtime-broker-token=$BROKER_TOKEN" \
      > "$hl" 2>&1 &
  echo $! > "$RIG/harness.pid"
  ln -sf "$hl" "$LOGS/harness.log"
  for i in $(seq 1 90); do
    curl -sf -o /dev/null -H "authorization: Bearer $HARNESS_TOKEN" "http://127.0.0.1:$HARNESS_PORT/health" && break
    sleep 1
  done
  curl -sf -o /dev/null -H "authorization: Bearer $HARNESS_TOKEN" "http://127.0.0.1:$HARNESS_PORT/health" || { echo "harness failed to boot"; tail -20 "$hl"; return 1; }
  echo "harness up (pid $(cat $RIG/harness.pid), dist-$HARNESS_DIST, broker via $HARNESS_BROKER_URL)"
}

if [ "$MODE" = harness ]; then start_harness; exit $?; fi

# --- rig MariaDB (private instance; innodb_snapshot_isolation=OFF because
# MariaDB 11.8 otherwise answers the second Session open with 1020, a known
# main-side incompatibility unrelated to this PR) ---
if ! mysql --socket="$DB_SOCKET" -uroot -p"$DB_PASS" -e 'SELECT 1' >/dev/null 2>&1; then
  mkdir -p "$RIG/db/data"
  if [ ! -d "$RIG/db/data/mysql" ]; then
    mariadb-install-db --no-defaults --user=root --datadir="$RIG/db/data" \
      --auth-root-authentication-method=normal --skip-test-db > "$LOGS/db-install.log" 2>&1
  fi
  nohup mariadbd --no-defaults --user=root --datadir="$RIG/db/data" \
    --socket="$DB_SOCKET" --port=$DB_PORT --bind-address=127.0.0.1 \
    --innodb-snapshot-isolation=OFF --skip-log-bin --innodb-buffer-pool-size=256M \
    --pid-file="$RIG/db/pid" --log-error="$RIG/db/err.log" > /dev/null 2>&1 &
  for i in $(seq 1 30); do
    mysql --socket="$DB_SOCKET" -uroot -e 'SELECT 1' > /dev/null 2>&1 && break
    mysql --socket="$DB_SOCKET" -uroot -p"$DB_PASS" -e 'SELECT 1' > /dev/null 2>&1 && break
    sleep 1
  done
  mysql --socket="$DB_SOCKET" -uroot -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$DB_PASS'; CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '$DB_PASS'; GRANT ALL ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;" 2>/dev/null || true
fi
mysql --socket="$DB_SOCKET" -uroot -p"$DB_PASS" -e 'SELECT 1' >/dev/null 2>&1 || { echo "rig MariaDB not up" >&2; exit 1; }
sql_db "CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;"

# --- OSS shim (TLS; the cert is already in this rig's JDK cacerts) ---
OSS_APEX=oss-cn-hangzhou.aliyuncs.com
OSS_BUCKET=h3-accept-rig
if curl -sk -o /dev/null --max-time 2 "https://127.0.0.1:$OSS_PORT/?versioning"; then
  echo "oss shim already up"
else
  RIG_ROOT=$RIG PORT=$OSS_PORT nohup "$NODE_BIN" "$RIG/oss-shim.mjs" > "$LOGS/oss-shim.log" 2>&1 &
  echo $! > "$RIG/oss-shim.pid"
  sleep 1
fi

# --- Broker fault proxy (only consulted when the Harness is routed through it) ---
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PROXY_PORT/__rig/rules"; then
  UPSTREAM=http://127.0.0.1:$BROKER_PORT PORT=$PROXY_PORT nohup "$NODE_BIN" "$RIG/bproxy.mjs" > "$LOGS/bproxy.log" 2>&1 &
  echo $! > "$RIG/bproxy.pid"
fi

# --- Session Store fault proxy (the Harness reaches the store through it
# only when a case opens its Session with STORE_VIA_PROXY=1) ---
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$STORE_PROXY_PORT/__rig/rules"; then
  UPSTREAM=http://127.0.0.1:$SPRING_PORT PORT=$STORE_PROXY_PORT nohup "$NODE_BIN" "$RIG/bproxy.mjs" > "$LOGS/sproxy.log" 2>&1 &
  echo $! > "$RIG/sproxy.pid"
fi

# --- 1. managed-agent-server ---
if curl -sf -o /dev/null "http://127.0.0.1:$SPRING_PORT/actuator/health"; then
  echo "spring already up"
else
  MOUNT_ARGS=()
  i=0
  for s in $STORAGES; do
    MOUNT_ARGS+=("--qwen.managed-agent.runtime-broker.workspace-mounts[$i].tenant-id=$TENANT"
                 "--qwen.managed-agent.runtime-broker.workspace-mounts[$i].storage-id=st-$s"
                 "--qwen.managed-agent.runtime-broker.workspace-mounts[$i].root=$MOUNTS/st-$s")
    i=$((i+1))
  done
  env -i HOME="$HOME_JAVA" LANG=C LC_ALL=C PATH=/usr/local/bin:/usr/bin:/bin \
    TMPDIR=/tmp \
    NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
    QWEN_HOME="$HOME_JAVA/.qwen" \
    SERVER_PORT=$SPRING_PORT \
    "SPRING_DATASOURCE_URL=jdbc:mysql://127.0.0.1:$DB_PORT/$DB_NAME?useSSL=false&allowPublicKeyRetrieval=true" \
    SPRING_DATASOURCE_USERNAME=root \
    SPRING_DATASOURCE_PASSWORD=$DB_PASS \
    QWEN_MANAGED_AGENT_APPROVAL_MODE=yolo \
    QWEN_MANAGED_AGENT_CAPABILITY_DIGEST="$CAPABILITY_DIGEST" \
    QWEN_MANAGED_AGENT_HARNESS_BASE_URL="http://127.0.0.1:$HARNESS_PORT" \
    QWEN_MANAGED_AGENT_HARNESS_ENABLED=true \
    QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT=120s \
    QWEN_MANAGED_AGENT_HARNESS_TOKEN="$HARNESS_TOKEN" \
    QWEN_MANAGED_AGENT_RUNTIME_TRUSTED_LOCAL_REBOOT_RECOVERY=false \
    QWEN_MANAGED_AGENT_RUNTIME_VERIFIED_WORKSPACE_RECOVERY_ENABLED=true \
    QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER=$ACTOR_HEADER \
    QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED=true \
    QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS=true \
    QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL="http://127.0.0.1:$SPRING_PORT" \
    QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED=true \
    QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION=60s \
    QWEN_MANAGED_AGENT_WORKSPACE_ID="$WORKSPACE_RUNTIME_ID" \
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED=true \
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT=$BROKER_PORT \
    QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN="$BROKER_TOKEN" \
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY="$CREDENTIAL_KEY" \
    QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID=pr14021-v1 \
    QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY="$STATE_DIR" \
    QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY="$WORKER_CLI" \
    QWEN_MANAGED_AGENT_NODE_EXECUTABLE="$NODE_BIN" \
    QWEN_MANAGED_AGENT_CLI_ENTRY="$WORKER_CLI" \
    QWEN_MANAGED_AGENT_WORKSPACE_CWD="$WORKSPACE" \
    QWEN_MANAGED_HOOK_CGROUP_ROOT="$CGROUP_ROOT" \
    OSS_ACCESS_KEY_ID=rig-ak OSS_ACCESS_KEY_SECRET=rig-sk \
    "$JAVA" -Duser.timezone=UTC \
      -jar "$SERVER_JAR" \
      --server.address=127.0.0.1 --server.port=$SPRING_PORT \
      "${MOUNT_ARGS[@]}" \
      "--qwen.managed-agent.tool-publication.enabled=true" \
      "--qwen.managed-agent.tool-publication.oss-endpoint=https://$OSS_APEX:$OSS_PORT" \
      "--qwen.managed-agent.tool-publication.oss-region=cn-hangzhou" \
      "--qwen.managed-agent.tool-publication.oss-bucket=$OSS_BUCKET" \
      "--qwen.managed-agent.tool-publication.service-base-url=http://127.0.0.1:$SPRING_PORT" \
      "--qwen.managed-agent.tool-publication.execution-bytes=268435456" \
      "--qwen.managed-agent.tool-publication.session-bytes=8589934592" \
      "--qwen.managed-agent.tool-publication.tenant-bytes=34359738368" \
      "--qwen.managed-agent.tool-publication.active-captures=${PUB_ACTIVE_CAPTURES:-64}" \
      "--qwen.managed-agent.tool-publication.entry-concurrency=8" \
      "--qwen.managed-agent.tool-publication.operation-timeout=120s" \
      "--qwen.managed-agent.tool-publication.claim-timeout=60s" \
      "--qwen.managed-agent.tool-publication.verification-bytes-per-second=10485760" \
      "--qwen.managed-agent.tool-publication.max-verification-timeout=300s" \
      > "$LOGS/spring-$(date +%H%M%S).log" 2>&1 &
  echo $! > "$RIG/spring.pid"
  ln -sf "$(ls -t "$LOGS"/spring-*.log | head -1)" "$LOGS/spring.log"
  wait_url spring "http://127.0.0.1:$SPRING_PORT/actuator/health" 150 || { tail -30 "$LOGS/spring.log"; exit 1; }
  echo "spring up (pid $(cat $RIG/spring.pid), $ARM_JAR.jar, db $DB_NAME, active-captures ${PUB_ACTIVE_CAPTURES:-64})"
fi

# --- 2. workspace rows (idempotent), one Workspace per storage, and native
# storage registration (#14069: LOCAL tools need a REGISTERED ma_storage row;
# same procedure as scripts/run-managed-agent-server-e2e.ts registerStorage).
for s in $STORAGES; do
  sql "INSERT INTO ma_workspace (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('$TENANT','ws-$s',1,'st-$s','PR14021 $s','managed-runtime-tools/1','preapproved-workspace-tools/1','ACTIVE') ON DUPLICATE KEY UPDATE state='ACTIVE'"
  sql "INSERT INTO ma_workspace_access (tenant_id, workspace_id, actor_id, role) VALUES ('$TENANT','ws-$s','$ACTOR','OPERATOR') ON DUPLICATE KEY UPDATE role='OPERATOR'"
  reg=$(sql "SELECT COUNT(*) FROM ma_storage WHERE tenant_id='$TENANT' AND storage_id='st-$s' AND registration_state='REGISTERED'")
  if [ "$reg" != 1 ]; then
    # The root's mtime must differ from its birth time (registration refuses a pristine dir).
    mkdir "$MOUNTS/st-$s/.storage-registration-touch" && rmdir "$MOUNTS/st-$s/.storage-registration-touch"
    env -i HOME="$HOME_JAVA" LANG=C LC_ALL=C PATH=/usr/local/bin:/usr/bin:/bin TMPDIR=/tmp \
      "W1_JDBC_URL=jdbc:mysql://127.0.0.1:$DB_PORT/$DB_NAME?useSSL=false&allowPublicKeyRetrieval=true" \
      W1_JDBC_USER=root W1_JDBC_PASSWORD=$DB_PASS \
      "$JAVA" -cp "$SERVER_JAR" -Dloader.main=com.alibaba.qwen.code.managedagent.store.WorkspaceStorageRegistrationMain \
        org.springframework.boot.loader.launch.PropertiesLauncher register "$TENANT" "st-$s" "$MOUNTS/st-$s" "$(cat /proc/sys/kernel/random/uuid)" --offline-confirmed \
        > "$LOGS/register-st-$s.log" 2>&1 || { echo "storage registration st-$s failed"; tail -20 "$LOGS/register-st-$s.log"; exit 1; }
  fi
  echo "storage st-$s: $(sql "SELECT registration_state, storage_kind FROM ma_storage WHERE tenant_id='$TENANT' AND storage_id='st-$s'" | tr '\t' ' ')"
done

# --- 3. fake model ---
if ! grep -q '^repo fake model on ' "$LOGS/fake-model.log" 2>/dev/null || ! kill -0 "$(cat "$RIG/fake-model.pid" 2>/dev/null)" 2>/dev/null; then
  : > "$LOGS/fake-model.log"
  PORT=$FAKE_PORT nohup "$NODE_BIN" "$RIG/repo-fake-model.bundle.mjs" > "$LOGS/fake-model.log" 2>&1 &
  echo $! > "$RIG/fake-model.pid"
  for i in $(seq 1 20); do
    grep -q '^repo fake model on ' "$LOGS/fake-model.log" && break
    sleep 0.5
  done
fi
echo "fake model at $(sed -n 's/^repo fake model on //p' "$LOGS/fake-model.log" | head -1)"

# --- 4. hosted-harness daemon ---
start_harness || exit 1
echo "RIG UP jar=$ARM_JAR harness=dist-$HARNESS_DIST worker=dist-$WORKER_DIST db=$DB_NAME"
