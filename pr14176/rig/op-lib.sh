# Operator walk-through helpers. Values follow docs/deployment.md from the extracted bundle.
set -euo pipefail
R=/rig/op2
B=$R/download/qwen-managed-agent-reference-0.0.0-pr.14176
mkdir -p $R/harness-home $R/workspace $R/logs
if [[ ! -f $R/secrets.env ]]; then
  {
    echo "export QWEN_MANAGED_AGENT_HARNESS_TOKEN='$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')'"
    echo "export QWEN_MANAGED_AGENT_CAPABILITY_DIGEST='sha256:$(head -c 32 /dev/urandom | sha256sum | cut -c1-64)'"
  } > $R/secrets.env
fi
source $R/secrets.env
cat > $R/qwen <<'Q'
#!/usr/bin/env sh
exec node /rig/cli-landed/dist/cli.js "$@"
Q
chmod +x $R/qwen
start_model() {
  [[ -f $R/model.pid ]] && kill -0 "$(cat $R/model.pid)" 2>/dev/null && return 0
  nohup node /rig/fake-model.ts $R/logs/fake-model.log > $R/logs/fake-model.out 2>&1 &
  echo $! > $R/model.pid
  for i in $(seq 1 50); do grep -q http $R/logs/fake-model.out 2>/dev/null && break; sleep 0.2; done
  cat $R/logs/fake-model.out
}
start_harness() {
  local base; base="$(grep -m1 -o 'http://[^ ]*' $R/logs/fake-model.out)"
  cd $R/workspace
  # Exactly the doc's command; model wiring is the operator's own Harness configuration.
  HOME=$R/harness-home OPENAI_API_KEY=fake-key OPENAI_BASE_URL="$base" OPENAI_MODEL=fake-model QWEN_MODEL=fake-model \
  QWEN_SERVER_TOKEN="$QWEN_MANAGED_AGENT_HARNESS_TOKEN" \
  QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST="$QWEN_MANAGED_AGENT_CAPABILITY_DIGEST" \
    nohup $R/qwen serve --profile hosted-harness --port 4170 --hostname 127.0.0.1 --no-web > $R/logs/harness.log 2>&1 &
  echo $! > $R/harness.pid
  for i in $(seq 1 120); do
    curl -fsS -H "authorization: Bearer $QWEN_MANAGED_AGENT_HARNESS_TOKEN" http://127.0.0.1:4170/health > $R/logs/harness-health.json 2>/dev/null && break
    kill -0 "$(cat $R/harness.pid)" 2>/dev/null || { echo HARNESS_DIED; tail -20 $R/logs/harness.log; return 1; }
    sleep 0.5
  done
  echo "harness health: $(cat $R/logs/harness-health.json)"
}
java_env() {
  export SPRING_DATASOURCE_URL='jdbc:mysql://127.0.0.1:3306/qwen_managed_agent'
  export SPRING_DATASOURCE_USERNAME='qwen'
  export SPRING_DATASOURCE_PASSWORD='qwen'
  export QWEN_MANAGED_AGENT_HARNESS_ENABLED='true'
  export QWEN_MANAGED_AGENT_HARNESS_BASE_URL='http://127.0.0.1:4170'
}
start_java() {  # $1 = log name
  local log=$R/logs/$1.log
  ( java_env; cd $B; nohup bin/qwen-managed-agent-server > $log 2>&1 & echo $! > $R/java.pid )
  for i in $(seq 1 180); do
    if curl -fsS http://127.0.0.1:8080/actuator/health > $R/logs/$1-health.json 2>/dev/null; then echo "JAVA_UP $(cat $R/logs/$1-health.json) after ${i}s"; return 0; fi
    if ! kill -0 "$(cat $R/java.pid)" 2>/dev/null; then echo "JAVA_EXITED after ${i}s"; return 1; fi
    sleep 1
  done
  echo JAVA_TIMEOUT; return 1
}
stop_java() { local p; p="$(cat $R/java.pid)"; kill "$p" 2>/dev/null || true; for i in $(seq 1 60); do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done; }
store_env() {  # the four Session Store variables from docs/server-reference.md (README) "Hosted Harness" section
  export QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED='true'
  export QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL='http://127.0.0.1:8080'
  export QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION='60s'
  export QWEN_MANAGED_AGENT_WORKSPACE_ID='reference-workspace'
}
