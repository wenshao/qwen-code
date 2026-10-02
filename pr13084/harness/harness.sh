#!/bin/bash
# VERIFICATION RIG ONLY (PR #13084). usage: harness.sh   (env CLI_WT, MODEL_URL)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/e46b98ed-673c-4dc9-a786-247efff94c81/scratchpad; R=$S/rig; CLI=${CLI_WT:-/Users/wenshao/git/qwen-code-pr13084}/dist/cli.js
H=$R/hhome; mkdir -p $H/.qwen $R/run/hruntime
MODEL_URL=${MODEL_URL:-http://127.0.0.1:15084/v1}
cat > $H/.qwen/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"rig-model"},"telemetry":{"enabled":false},
 "modelProviders":{"openai":[{"id":"rig-model","envKey":"OPENAI_API_KEY","baseUrl":"$MODEL_URL"}]}}
JSON
cd $R/decoy
exec env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$H USERPROFILE=$H QWEN_HOME=$H/.qwen TZ=UTC \
  QWEN_RUNTIME_DIR=$R/run/hruntime OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=$MODEL_URL \
  QWEN_SERVER_TOKEN=rig-o41-token QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$R/run/sys-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$R/run/sys-defaults.json \
  QWEN_CODE_TRUSTED_FOLDERS_PATH=$R/run/trusted.json \
  /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node $CLI serve --profile hosted-harness --http-bridge \
  --hostname 127.0.0.1 --port 17084 --require-auth --no-web --workspace $R/decoy \
  --managed-runtime-broker-url http://127.0.0.1:19084 --managed-runtime-broker-token rig-o41-token
