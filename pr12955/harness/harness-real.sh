#!/bin/bash
# Real-model Harness: same wiring as harness.sh, provider from ~/.qwen/settings.json (key via env only).
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
R=$SP/rig; CLI=$SP/wt-${CLI_ARM:-pr}/dist/cli.js; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
H=$R/hhome-real; mkdir -p $H/.qwen $R/run/hruntime-real
URL=${REAL_MODEL_BASE_URL:?set REAL_MODEL_BASE_URL}
KEY=${REAL_MODEL_API_KEY:?set REAL_MODEL_API_KEY}
cat > $H/.qwen/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"qwen3.8-max"},"telemetry":{"enabled":false},
 "modelProviders":{"openai":[{"id":"qwen3.8-max","envKey":"OPENAI_API_KEY","baseUrl":"$URL"}]}}
JSON
cd $R/decoy
exec env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$H USERPROFILE=$H QWEN_HOME=$H/.qwen TZ=UTC \
  QWEN_RUNTIME_DIR=$R/run/hruntime-real OPENAI_API_KEY=$KEY OPENAI_BASE_URL=$URL \
  QWEN_SERVER_TOKEN=rig-g0-token QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$R/run/sys-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$R/run/sys-defaults.json \
  QWEN_CODE_TRUSTED_FOLDERS_PATH=$R/run/trusted.json \
  $NODE $CLI serve --profile hosted-harness --http-bridge \
  --hostname 127.0.0.1 --port 17955 --require-auth --no-web --workspace $R/decoy \
  --managed-runtime-broker-url http://127.0.0.1:19955 --managed-runtime-broker-token rig-g0-token
