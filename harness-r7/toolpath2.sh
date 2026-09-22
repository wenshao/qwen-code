#!/bin/bash
# Model tool path: disjoint ws / QWEN_HOME (headless -p enforces workspace!=home/install overlap).
# Scripted model calls run_shell_command; prompt is piped on the CLI's stdin. R6-1 must not leak in.
V=/root/verify/r7
TP=/tmp/tp; rm -rf $TP; mkdir -p $TP/ws $TP/hro $TP/hww
printf '{"tools":{"executionSandbox":{"backend":"auto","filesystem":"workspace-write","network":"closed"}}}\n' > $TP/hww/settings.json
node $V/fake-model.js 18472 $TP/req.jsonl >/dev/null 2>&1 & FM=$!; sleep 1
# The probe: try to write OUTSIDE ws, report stdin link+bytes and pid count
echo 'echo esc > /tmp/tp-outside.txt 2>&1; echo "outside-rc=$?"; echo "stdin=$(readlink /proc/self/fd/0) bytes=$(timeout 2 cat | wc -c)"; echo "pids=$(ls /proc | grep -cE ^[0-9]+$)"' > $V/fake-tool-cmd.txt
run() { # arm home
  local ARM=$1 HOME_D=$2 LABEL=$3
  rm -f /tmp/tp-outside.txt
  echo "SECRET-STDIN" | timeout -k 2 90 env QWEN_HOME=$HOME_D QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent \
    bash -c "cd $TP/ws && node $V/dist-$ARM/cli.js --approval-mode yolo --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18472/v1 --model dummy -o stream-json -p 'run the probe'" > $TP/o-$LABEL.jsonl 2> $TP/e-$LABEL.log
  local res=$(python3 - "$TP/o-$LABEL.jsonl" <<'PY'
import sys,json
for l in open(sys.argv[1]):
  try: j=json.loads(l)
  except: continue
  for c in j.get("message",{}).get("content",[]):
    if isinstance(c,dict) and c.get("type")=="tool_result":
      v=c.get("content"); print((json.dumps(v) if not isinstance(v,str) else v)[:200]); sys.exit()
PY
)
  printf '%-16s host-outside=%s | %s | err=%s\n' "$LABEL" "$([ -f /tmp/tp-outside.txt ] && echo WRITTEN || echo absent)" "${res:-<none>}" "$(grep -m1 -i error $TP/e-$LABEL.log | cut -c1-70)"
}
run A $TP/hww "A_ww-closed"
run A $TP/hro  "A_no-policy"
run B $TP/hww "B_ww-closed"
kill $FM 2>/dev/null; rm -f $V/fake-tool-cmd.txt /tmp/tp-outside.txt
