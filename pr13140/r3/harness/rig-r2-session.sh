#!/bin/sh
# R2 headless sessions (fake model ledger) for prompt wording and the release-shaped install.
H=/home/node; mkdir -p $H/ws $H/ledgers2; cd $H/ws
for pol in bwrap:closed bwrap:open landlock:open; do
  b=${pol%%:*}; n=${pol##*:}
  echo "{\"tools\":{\"executionSandbox\":{\"backend\":\"$b\",\"filesystem\":\"workspace-write\",\"network\":\"$n\"}}}" > $H/.qwen/settings.json
  for inst in head-local head-rel; do
    L=$H/ledgers2/$inst-$b-$n.jsonl; rm -f $L
    python3 /tmp/fake_openai.py 18451 $L & P=$!; sleep 0.7
    out=$(timeout 90 node /opt/$inst/lib/node_modules/@qwen-code/qwen-code/cli-entry.js -p "RUN-TOOL please" --approval-mode yolo \
      --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18451/v1 --model fake-model 2>&1); rc=$?
    kill $P; wait $P 2>/dev/null
    echo "== $inst $b/$n exit=$rc requests=$(cat $L 2>/dev/null | wc -l) :: $(echo "$out" | grep -v -E '^$|Ripgrep' | tail -1 | cut -c1-160)"
  done
done
python3 - <<'PY'
import json, glob, re
for f in sorted(glob.glob('/home/node/ledgers2/*.jsonl')):
    reqs = [json.loads(l) for l in open(f)]
    if not reqs: continue
    sysmsg = next((m['content'] for m in reqs[0]['messages'] if m['role'] == 'system'), '')
    if not isinstance(sysmsg, str): sysmsg = json.dumps(sysmsg)
    sec = re.search(r'# Tool Execution Sandbox[^\n]*\n([^\n]*)', sysmsg)
    line = sec.group(1) if sec else ''
    net = re.findall(r'(command network policy is \w+|Command network policy is \w+|command network access follows the operator policy|Closed networking prevents[^.]*\.)', line)
    tool = [m for r in reqs for m in r['messages'] if m['role'] == 'tool']
    c = tool[-1]['content'] if tool else ''
    c = c if isinstance(c, str) else ' '.join(p.get('text', '') for p in c)
    print(f.split('/')[-1], net, re.findall(r'(tool-ran uid=\d+|fresh-ip-connect -?\d+)', c))
PY
