#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13773): compact table from results/<db>/agent-snaps.json
import json, sys
db = sys.argv[1]
snaps = json.load(open(f'/Users/wenshao/pr13773-rig/results/{db}/agent-snaps.json'))
def ans(a):
    if a is None: return 'none'
    if 'started in the background' in a: return 'STARTED(bg)'
    if 'unavailable while' in a: return 'REFUSED:' + ('owner' if 'MCP owner' in a else 'turn')
    if 'G_DONE kind=CHILD' in a: return 'CHILD-RESULT(fg)'
    return a[:60]
print(f"{'scen':4} {'answer':18} {'childRun':22} {'childTurn':38} {'busy409':>7} {'file':5} {'parentTurns':45} hooks")
for k, v in snaps.items():
    f = v['final']; e = v['early']
    print(f"{k:4} {ans(f['parentAnswer']):18} {','.join(f['childRuns']) or '-':22} {','.join(f['childTurns']) or '-':38} {f['brokerBusy409ForChild']:>7} {str(f['childFile']):5} {','.join(f['parentTurns']):45} {','.join(f['hookRuns'])}  parentMs={v['parentMs']}")
