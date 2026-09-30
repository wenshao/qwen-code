#!/bin/bash
# VERIFICATION RIG ONLY (PR #13037). usage: harness.sh   (env CLI_WT, MODEL_URL)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/19f717cd-fa69-4495-b803-21c540ab1bd6/scratchpad; R=$S/rig; CLI=${CLI_WT:-/Users/wenshao/git/qwen-code-pr13037}/dist/cli.js
H=$R/hhome; mkdir -p $H/.qwen $R/run/hruntime
MODEL_URL=${MODEL_URL:-http://127.0.0.1:15037/v1}
cat > $H/.qwen/settings.json <<JSON
{"security":{"auth":{"selectedType":"openai"}},"model":{"name":"rig-model"},"telemetry":{"enabled":false},
 "modelProviders":{"openai":[{"id":"rig-model","envKey":"OPENAI_API_KEY","baseUrl":"$MODEL_URL"}]}}
JSON
cd $R/decoy
exec env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$H USERPROFILE=$H QWEN_HOME=$H/.qwen TZ=UTC \
  QWEN_RUNTIME_DIR=$R/run/hruntime OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=$MODEL_URL \
  QWEN_SERVER_TOKEN=rig-o3-token QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$R/run/sys-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$R/run/sys-defaults.json \
  QWEN_CODE_TRUSTED_FOLDERS_PATH=$R/run/trusted.json \
  /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node $CLI serve --profile hosted-harness --http-bridge \
  --hostname 127.0.0.1 --port 17037 --require-auth --no-web --workspace $R/decoy \
  --managed-runtime-broker-url http://127.0.0.1:19037 --managed-runtime-broker-token rig-o3-token
