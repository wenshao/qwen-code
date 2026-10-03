WS=$1; OUT=$2
mkdir -p "$OUT/home/.qwen"
cat > "$OUT/home/.qwen/settings.json" <<J
{ "hooks": { "SubagentStop": [ { "hooks": [ { "type": "command", "command": "node /root/verify/pr10916/r2/harness/subagent-stop-hook.cjs $OUT/hook-calls.jsonl" } ] } ] } }
J
