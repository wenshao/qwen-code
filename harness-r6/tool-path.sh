#!/bin/bash
# model tool path: head+policy / head no-policy / previous head+policy; prompt piped on stdin to the CLI
cd /root/verify/h12267r6
echo 'echo tool-escape > /root/verify/h12267r6/tool-outside.txt 2>&1; echo "outside-rc=$?"; echo "pids=$(ls /proc | grep -cE "^[0-9]+$")"; echo "stdin=$(readlink /proc/self/fd/0) bytes=$(timeout 2 cat | wc -c)"' > fake-tool-cmd.txt
if [ $# -gt 0 ]; then SPECLIST=("$@"); else SPECLIST=("r7 ww-closed" "r7 none" "r6 ww-closed" "r7fix ww-closed"); fi
for spec in "${SPECLIST[@]}"; do
  set -- $spec; rm -f tool-outside.txt
  echo "SECRET-PROMPT-STDIN-LINE" | timeout -k 2 90 ./q.sh $1 $2 --approval-mode yolo --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18461/v1 --model dummy -o stream-json -p "run the probe" > out/tool-$1-$2.jsonl 2> out/tool-$1-$2.err
  rc=$?
  res=$(grep '"tool_result"' out/tool-$1-$2.jsonl | head -1 | python3 -c 'import sys,json
for l in sys.stdin:
  j=json.loads(l)
  for c in j.get("message",{}).get("content",[]):
    if c.get("type")=="tool_result": print(json.dumps(c.get("content"))[:260])')
  printf '%-6s %-9s rc=%s host-file=%s | %s\n' $1 $2 $rc "$( [ -f tool-outside.txt ] && echo WRITTEN || echo absent)" "$res"
done
rm -f fake-tool-cmd.txt tool-outside.txt
