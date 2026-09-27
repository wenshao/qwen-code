#!/bin/bash
SP=/path/to/scratchpad
D=$SP/rig/run-daemon; mkdir -p $D/home/.qwen $D/runtime $D/tmp $D/ws
cp $SP/rig/home/.qwen/settings.json $D/home/.qwen/settings.json
cd $D/ws
exec env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$D/home USERPROFILE=$D/home QWEN_HOME=$D/home/.qwen QWEN_RUNTIME_DIR=$D/runtime \
  TMPDIR=$D/tmp OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=http://127.0.0.1:33849/v1 OPENAI_MODEL=rig-model \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$D/system-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$D/system-defaults.json QWEN_CODE_TRUSTED_FOLDERS_PATH=$D/trusted-folders.json \
  $HOME/.local/share/fnm/node-versions/v24.18.1/installation/bin/node $SP/wt-pr/dist/cli.js serve --http-bridge --port 33856 --hostname 127.0.0.1 --no-web --workspace $D/ws
