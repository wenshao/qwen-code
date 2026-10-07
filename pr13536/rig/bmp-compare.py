#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13536): verdict comparison for one sweep field.
# usage: bmp-compare.py <rows.jsonl> <ts.jsonl> <java.jsonl> <field-label> >> summary.tsv ; disagreements -> stderr as JSON
import json, sys, collections
rows, ts, jv, label = sys.argv[1:5]
c = collections.Counter(); bad = []
with open(rows) as fr, open(ts) as ft, open(jv) as fj:
    for lr, lt, lj in zip(fr, ft, fj):
        r = json.loads(lr); t = json.loads(lt); j = json.loads(lj)
        assert r['id'] == t['id'] == j['id']
        c['rows'] += 1
        tv = 'UNREAD' if not t.get('read') else ('ACCEPT' if t.get('ok') else 'REFUSE')
        jvv = 'UNREAD' if not j.get('read') else ('ACCEPT' if j.get('ok') else 'REFUSE')
        if tv == jvv and tv == 'ACCEPT':
            if any(t.get(f) != j.get(f) for f in ('rid', 'task', 'start')): tv += '*'
        c[tv if tv == jvv else 'DIFF'] += 1
        if tv != jvv:
            bad.append({'field': label, 'cp': r['cp'], 'hex': f"U+{r['cp']:04X}", 'shape': r['shape'], 'ts': tv, 'java': jvv,
                        'tsErr': t.get('err'), 'javaErr': j.get('err')})
assert c['rows'] > 0
print(f"{label}\trows={c['rows']}\tACCEPT={c['ACCEPT']}\tREFUSE={c['REFUSE']}\tUNREAD={c['UNREAD']}\tDIFF={c['DIFF']}\tACCEPT*={c['ACCEPT*']}")
for b in bad: print(json.dumps(b, ensure_ascii=True), file=sys.stderr)
