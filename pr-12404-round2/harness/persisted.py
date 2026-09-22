# persisted.py <post-json> [runtime-dir] — print the persisted user record's systemPayload summary per case.
import json, sys, glob, os
d = json.load(open(sys.argv[1])); rt = sys.argv[2] if len(sys.argv) > 2 else 'runtime'
out = {}
for name, c in d['cases'].items():
    files = [f for f in glob.glob(f"{rt}/projects/*/chats/{c['sid']}.jsonl")]
    rec = None
    for f in files:
        for line in open(f):
            if name not in line: continue
            try: o = json.loads(line)
            except Exception: continue
            if o.get('type') == 'user': rec = o; break
    sp = (rec or {}).get('systemPayload')
    anns = sp.get('inputAnnotations') if isinstance(sp, dict) else None
    kind = lambda a: 'null' if a is None else 'array' if isinstance(a, list) else type(a).__name__
    out[name] = {'record': rec is not None, 'recordBytes': len(json.dumps(rec)) if rec else None,
                 'systemPayloadKeys': sorted(sp.keys()) if isinstance(sp, dict) else None,
                 'annotations': len(anns) if isinstance(anns, list) else None,
                 'types': [kind(a) for a in anns][:8] if isinstance(anns, list) else None,
                 'first': (json.dumps(anns[0])[:220] if isinstance(anns, list) and anns else None)}
    print(name, json.dumps(out[name]))
json.dump(out, open(sys.argv[1].replace('.json', '-persisted.json'), 'w'), indent=1)
