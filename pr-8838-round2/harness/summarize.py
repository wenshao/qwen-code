import json, re, sys
def recs(path):
    out=[]
    for l in open(path):
        r=json.loads(l)
        if r.get('type') not in ('user','assistant','tool_result'): continue
        parts=(r.get('message') or {}).get('parts') or []
        t=' | '.join(p.get('text') or ('<call '+p['functionCall']['name']+'>' if 'functionCall' in p else ('<result '+p['functionResponse']['name']+'>' if 'functionResponse' in p else '')) for p in parts)
        t=re.sub(r'<system-reminder>.*?</system-reminder>','',t,flags=re.S).strip()
        out.append((r['type'], r.get('subtype') or '-', r.get('provenance') or '-', ((r.get('systemPayload') or {}).get('displayText') or '')[:40], t[:70]))
    return out
def wire(path, kind):
    for l in open(path):
        r=json.loads(l)
        if r['kind']==kind:
            return [(m['role'], m['text'][:70] or ('<'+','.join(m['toolCalls'])+'>' if m['toolCalls'] else '')) for m in r['messages'] if m['role']!='system']
for arm in sys.argv[1:]:
    print('=====', arm)
    for x in recs(f'{arm}/out/transcript.jsonl'): print('  ', x)
