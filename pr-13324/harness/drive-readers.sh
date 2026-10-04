#!/bin/bash
# usage: drive-readers.sh <reader-arm: head|base> <source-run> <out>
# Reads ONE head-written session with the given arm's real binary:
# /export json + md, then a cross-version resume turn.
set -u
ARM=$1; SRC=$2; OUT=$3
CLI=/root/verify/pr13324/$ARM/dist/cli.js
H=/root/verify/pr13324/harness
rm -rf "$OUT"; mkdir -p "$OUT"
cp -a "$SRC/home" "$OUT/home"  # cwd stays at the source ws: the project dir is keyed by cwd
SID=$(sed -n 's/^SESSION=//p' "$SRC/exit.txt")
# Pin the transcript to its post-goal state so both readers see identical bytes.
CHAT=$(ls "$OUT"/home/.qwen/projects/*/chats/"$SID".jsonl)
for v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_COLOR; do unset $v; done
export HOME="$OUT/home" USERPROFILE="$OUT/home" QWEN_SANDBOX=false QWEN_CODE_NO_RELAUNCH=1
export LOG="$OUT/requests.jsonl" FIXTURE="$SRC/ws/fact.txt" MISSING="$SRC/ws/missing.txt"
node "$H/fake-model.cjs" > "$OUT/fake.out" 2>&1 &
FPID=$!
for i in $(seq 1 50); do grep -q FAKE_SERVER_READY "$OUT/fake.out" && break; sleep 0.1; done
URL=$(sed -n 's/^FAKE_SERVER_READY //p' "$OUT/fake.out")
COMMON=(--auth-type openai --openai-api-key dummy --openai-base-url "$URL" --model fake-model)
cd "$SRC/ws"
sha256sum "$CHAT" > "$OUT/chat-before.sha"
timeout 120 node "$CLI" "${COMMON[@]}" --resume "$SID" -p "/export json exports-$ARM" > "$OUT/export-json.out" 2>&1; echo "EXPORT_JSON_EXIT=$?" >> "$OUT/exit.txt"
timeout 120 node "$CLI" "${COMMON[@]}" --resume "$SID" -p "/export md exports-$ARM" > "$OUT/export-md.out" 2>&1; echo "EXPORT_MD_EXIT=$?" >> "$OUT/exit.txt"
mv "$SRC/ws/exports-$ARM" "$OUT/exports" 2>/dev/null
echo '{"phase_start":"resume"}' >> "$LOG"
timeout 120 node "$CLI" "${COMMON[@]}" --output-format stream-json --resume "$SID" -p "PHASE2: read the fixture again" > "$OUT/phase2.jsonl" 2> "$OUT/phase2.err"; echo "RESUME_EXIT=$?" >> "$OUT/exit.txt"
kill $FPID 2>/dev/null; wait $FPID 2>/dev/null
cat "$OUT/exit.txt"
