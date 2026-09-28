#!/bin/bash
# usage: harness.sh  (env CLI_ARM, MODEL_URL)
SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fc30c1c3-658a-459a-9a85-13701a898397/scratchpad
R=$SP/rig; CLI=$SP/wt-${CLI_ARM:-pr}/dist/cli.js
H=$R/hhome; mkdir -p $H/.qwen $R/run/hruntime
MODEL_URL=${MODEL_URL:-http://127.0.0.1:15955/v1}
cat > $H/.qwen/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"rig-model"},"telemetry":{"enabled":false},
 "modelProviders":{"openai":[{"id":"rig-model","envKey":"OPENAI_API_KEY","baseUrl":"$MODEL_URL"}]}}
JSON
cd $R/decoy
exec env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$H USERPROFILE=$H QWEN_HOME=$H/.qwen TZ=UTC \
  QWEN_RUNTIME_DIR=$R/run/hruntime OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=$MODEL_URL \
  QWEN_SERVER_TOKEN=rig-g0-token QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$R/run/sys-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$R/run/sys-defaults.json \
  QWEN_CODE_TRUSTED_FOLDERS_PATH=$R/run/trusted.json \
  /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node $CLI serve --profile hosted-harness --http-bridge \
  --hostname 127.0.0.1 --port 17955 --require-auth --no-web --workspace $R/decoy \
  --managed-runtime-broker-url http://127.0.0.1:19955 --managed-runtime-broker-token rig-g0-token
