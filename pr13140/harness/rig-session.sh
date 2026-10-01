#!/bin/sh
# Headless sessions through each install; the fake model ledger is the evidence.
H=/home/node; mkdir -p $H/ws $H/ledgers; cd $H/ws
python3 /tmp/fake_openai.py 18440 $H/ledgers/all.jsonl & FP=$!
sleep 1
for pol in bwrap:closed landlock:open; do
  b=${pol%%:*}; n=${pol##*:}
  echo "{\"tools\":{\"executionSandbox\":{\"backend\":\"$b\",\"filesystem\":\"workspace-write\",\"network\":\"$n\"}}}" > $H/.qwen/settings.json
  for inst in base-local head-local base-rel head-rel; do
    L=$H/ledgers/$inst-$b.jsonl; rm -f $L
    python3 /tmp/fake_openai.py 18441 $L & P=$!; sleep 0.7
    out=$(timeout 90 node /opt/$inst/lib/node_modules/@qwen-code/qwen-code/cli-entry.js -p "RUN-TOOL please" --approval-mode yolo \
      --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18441/v1 --model fake-model 2>&1); rc=$?
    kill $P; wait $P 2>/dev/null
    echo "== $inst $b/$n exit=$rc requests=$(wc -l < $L 2>/dev/null || echo 0)"
    echo "$out" | grep -v '^$' | tail -3 | cut -c1-260 | sed 's/^/   out| /'
  done
done
kill $FP
