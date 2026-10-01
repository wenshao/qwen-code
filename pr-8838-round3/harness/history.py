# Compare what the model is sent live vs after a cold restart.
#   python3 history.py <run dir>...
# Live = the FOLLOWUP-LIVE request, cold = the FOLLOWUP-COLD request; the cold
# request's prefix (up to and including the FOLLOWUP-LIVE answer) must equal the
# live request plus that answer if the transcript restores the same history.
import json, sys

def reqs(path):
    return [json.loads(l) for l in open(path) if l.strip()]

def conv(msgs):
    return [(m['role'], m['text'] or ('<' + ','.join(m['toolCalls']) + '>' if m['toolCalls'] else ''))
            for m in msgs if m['role'] != 'system']

for run in sys.argv[1:]:
    rs = reqs(f'{run}/out/model-requests.jsonl')
    print('=====', run)
    print('  request kinds:', ' '.join(r['kind'] for r in rs if r['kind'] != 'side'))
    live = next((r for r in rs if r['kind'] == 'followup' and conv(r['messages'])[-1][1].startswith('FOLLOWUP-LIVE')), None)
    cold = next((r for r in rs if r['kind'] == 'followup' and conv(r['messages'])[-1][1].startswith('FOLLOWUP-COLD')), None)
    if not live or not cold:
        print('  missing live/cold follow-up request'); continue
    L = conv(live['messages'])[:-1]
    C = conv(cold['messages'])
    k = next(i for i, m in enumerate(C) if m[1].startswith('FOLLOWUP-LIVE'))
    Cp = C[:k]
    print('  live history before FOLLOWUP-LIVE:')
    for m in L: print('     ', m[0], repr(m[1][:110]))
    print('  cold history before FOLLOWUP-LIVE:')
    for m in Cp: print('     ', m[0], repr(m[1][:110]))
    print('  COLD == LIVE:', Cp == L)
