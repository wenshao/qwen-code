#!/bin/bash
# VERIFICATION RIG ONLY (PR 13116): packaged Hosted Harness (dist/cli.js of main).
S=/Users/wenshao/pr13116-rig/stack; CLI=/Users/wenshao/pr13116-rig/${CLI_TREE:-wt-jar}/dist/cli.js
H=$S/hhome; mkdir -p $H/.qwen $S/run/hruntime $S/decoy
MODEL_URL=http://127.0.0.1:15116/v1
cat > $H/.qwen/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"rig-model"},"telemetry":{"enabled":false},
 "modelProviders":{"openai":[{"id":"rig-model","envKey":"OPENAI_API_KEY","baseUrl":"$MODEL_URL"}]}}
JSON
cd $S/decoy
exec env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$H USERPROFILE=$H QWEN_HOME=$H/.qwen TZ=UTC \
  QWEN_RUNTIME_DIR=$S/run/hruntime OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=$MODEL_URL \
  QWEN_SERVER_TOKEN=rig-13116-token QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$S/run/sys-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$S/run/sys-defaults.json \
  QWEN_CODE_TRUSTED_FOLDERS_PATH=$S/run/trusted.json \
  /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node $CLI serve --profile hosted-harness --http-bridge \
  --hostname 127.0.0.1 --port 17116 --require-auth --no-web --workspace $S/decoy \
  --managed-runtime-broker-url http://127.0.0.1:19116 --managed-runtime-broker-token rig-13116-token
