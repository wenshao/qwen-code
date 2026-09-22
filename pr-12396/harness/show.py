import json,sys
for f in sys.argv[1:]:
  d=json.load(open(f))
  print('=====', d['arm'], d['scenario'], d.get('extra') or '', 'error=',(d.get('error') or '')[:300])
  for s in d['steps']:
    c=s.get('control',{})
    print('  %-42s st=%s en=%s sel=%s workers=%s peers=%s'%(s['label'][:42],s.get('status'),c.get('enabled'),json.dumps((c.get('selection') or {}).get('names') if c.get('selection') else None),json.dumps([(w['ws'],w['channels'],w['state']) for w in c.get('workers',[])]),json.dumps({k:(v['connects'],v['open']) for k,v in (s.get('peers') or {}).items()})))
