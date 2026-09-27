import json, sys
# apply.py <mutants.json> <lang> <id> <file>...: replace the anchor exactly once per file
m = {x['id']: x for x in json.load(open(sys.argv[1]))[sys.argv[2]]}[sys.argv[3]]
for f in sys.argv[4:]:
    s = open(f, encoding='utf8').read()
    assert s.count(m['from']) == 1, (f, m['from'])
    open(f, 'w', encoding='utf8').write(s.replace(m['from'], m['to']))
print('applied', m['id'], 'to', len(sys.argv[4:]), 'file(s)')
