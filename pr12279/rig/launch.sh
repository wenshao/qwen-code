#!/bin/bash
# launch.sh <arm> <port>   — start one daemon for an arm (head|base) with an isolated home
R=/root/pr12279
ARM=$1; PORT=$2
H=$R/homes/$ARM; mkdir -p "$H/.qwen" "$H/rt" "$R/ws/$ARM" "$R/run" "$R/logs"
[ -f "$R/run/$ARM.token" ] || openssl rand -hex 16 | tr -d '\n' > "$R/run/$ARM.token"
TOKEN=$(cat "$R/run/$ARM.token")
cat > "$H/.qwen/settings.json" <<JSON
{ "general": { "language": "en" },
  "security": { "auth": { "selectedType": "openai" } },
  "model": { "name": "fake-model", "generationConfig": { "modalities": { "image": true } } },
  "tools": { "approvalMode": "yolo" },
  "privacy": { "usageStatisticsEnabled": false } }
JSON
[ -d "$R/ws/$ARM/.git" ] || (cd "$R/ws/$ARM" && git init -q && echo "rig" > README.md && echo "notes for the file variant" > notes.txt)
cd "$R/ws/$ARM"
nohup env -i HOME="$H" PATH=/usr/local/bin:/usr/bin:/bin QWEN_HOME="$H/.qwen" QWEN_RUNTIME_DIR="$H/rt" \
  OPENAI_API_KEY=sk-none OPENAI_BASE_URL=http://127.0.0.1:18279/v1 OPENAI_MODEL=fake-model LANG=C.UTF-8 \
  QWEN_CODE_NO_RELAUNCH=true \
  node "$R/$ARM/dist/cli.js" serve --hostname 127.0.0.1 --port "$PORT" --token "$TOKEN" \
  --workspace "$R/ws/$ARM" --initialize-timeout-ms 180000 > "$R/logs/daemon-$ARM.log" 2>&1 &
echo $! > "$R/run/daemon-$ARM.pid"
echo "started $ARM :$PORT pid=$(cat $R/run/daemon-$ARM.pid)"
