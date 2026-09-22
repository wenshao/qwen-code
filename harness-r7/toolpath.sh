#!/bin/bash
# model tool path unaffected: scripted model asks run_shell_command; the confined command must
# still see stdin=/dev/null and be unable to write outside ws. prompt piped on CLI stdin.
V=/root/verify/r7; cd $V
node fake-model.js 18471 $V/req.jsonl >/dev/null 2>&1 &
FM=$!; sleep 1
echo 'echo tool-escape > /root/verify/r7/tool-outside.txt 2>&1; echo "outside-rc=$?"; echo "stdin=$(readlink /proc/self/fd/0)"; echo "stdin-bytes=$(timeout 2 cat | wc -c)"; echo "pids=$(ls /proc | grep -cE "^[0-9]+$")"' > fake-tool-cmd.txt
for spec in "$@"; do
  set -- $spec; ARM=$1; POL=$2; rm -f tool-outside.txt
  echo "SECRET-STDIN-LINE" | timeout -k 2 90 env QWEN_HOME=$V/home-$POL QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent \
    node $V/dist-$ARM/cli.js --approval-mode yolo --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18471/v1 --model dummy -o stream-json -p "run the probe" > out-$ARM-$POL.jsonl 2> err-$ARM-$POL.log
  res=$(grep '"tool_result"' out-$ARM-$POL.jsonl | head -1 | python3 -c 'import sys,json
for l in sys.stdin:
 try: j=json.loads(l)
 except: continue
 for c in j.get("message",{}).get("content",[]):
  if c.get("type")=="tool_result": print(json.dumps(c.get("content"))[:220])' 2>/dev/null)
  printf '%-2s %-9s host-file=%s | %s\n' $ARM $POL "$([ -f tool-outside.txt ] && echo WRITTEN || echo absent)" "$res"
done
kill $FM 2>/dev/null; rm -f fake-tool-cmd.txt tool-outside.txt
