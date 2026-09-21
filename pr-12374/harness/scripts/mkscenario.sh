#!/bin/bash
# mkscenario.sh <dir>  -> isolated HOME / QWEN_HOME / QWEN_RUNTIME_DIR / workspace
set -eu
SC=$1; rm -rf "$SC"; mkdir -p "$SC"/{userhome,home,runtime,ws/app,outside}
cat > "$SC/home/settings.json" <<J
{ "security": { "folderTrust": { "enabled": false }, "auth": { "selectedType": "openai" } },
  "model": { "name": "mock-model" },
  "general": { "cleanupPeriodDays": 30 },
  "\$version": 4 }
J
ln -s ../home "$SC/userhome/.qwen"
(cd "$SC/ws/app" && git init -q && echo hi > README.md)
