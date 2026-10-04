#!/bin/bash
# usage: drive.sh <arm: head|base> <rundir>
# Real bundled CLI, isolated HOME, Code Mode on, deterministic fake provider.
set -u
ARM=$1
RUN=$2
CLI=/root/verify/pr13324/$ARM/dist/cli.js
H=/root/verify/pr13324/harness
rm -rf "$RUN"; mkdir -p "$RUN/home/.qwen" "$RUN/ws"
printf 'ORIGINAL_FILE_FACT\n' > "$RUN/ws/fact.txt"
cat > "$RUN/home/.qwen/settings.json" <<'EOF'
{ "tools": { "codeModeOnly": true }, "security": { "folderTrust": { "enabled": false } } }
EOF
for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_COLOR; do unset $v; done
export HOME="$RUN/home" USERPROFILE="$RUN/home" QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1
export LOG="$RUN/requests.jsonl" FIXTURE="$RUN/ws/fact.txt" MISSING="$RUN/ws/missing.txt"
node "$H/fake-model.cjs" > "$RUN/fake.out" 2>&1 &
FPID=$!
for i in $(seq 1 50); do grep -q FAKE_SERVER_READY "$RUN/fake.out" && break; sleep 0.1; done
URL=$(sed -n 's/^FAKE_SERVER_READY //p' "$RUN/fake.out")
COMMON=(--auth-type openai --openai-api-key dummy --openai-base-url "$URL" --model fake-model --output-format stream-json)
cd "$RUN/ws"
echo '{"phase_start":"goal"}' >> "$LOG"
timeout 180 node "$CLI" "${COMMON[@]}" -p "/goal Read fact.txt and compute 6 * 7" > "$RUN/phase1.jsonl" 2> "$RUN/phase1.err"
echo "PHASE1_EXIT=$?" | tee "$RUN/exit.txt"
SID=$(ls "$RUN"/home/.qwen/projects/*/chats/*.jsonl 2>/dev/null | head -1 | xargs -r basename | sed 's/\.jsonl$//')
echo "SESSION=$SID" | tee -a "$RUN/exit.txt"
cp "$RUN"/home/.qwen/projects/*/chats/"$SID".jsonl "$RUN/transcript-after-phase1.jsonl" 2>/dev/null
echo '{"phase_start":"resume"}' >> "$LOG"
timeout 120 node "$CLI" "${COMMON[@]}" --resume "$SID" -p "PHASE2: read the fixture again" > "$RUN/phase2.jsonl" 2> "$RUN/phase2.err"
echo "PHASE2_EXIT=$?" | tee -a "$RUN/exit.txt"
cp "$RUN"/home/.qwen/projects/*/chats/"$SID".jsonl "$RUN/transcript-after-phase2.jsonl" 2>/dev/null
kill $FPID 2>/dev/null
wait $FPID 2>/dev/null
echo DONE
