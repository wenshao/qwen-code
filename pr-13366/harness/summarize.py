import json, sys
def summ(arm):
    r=json.load(open(f'e2e/{arm}/driver-results.json'))
    out={}
    for c in r:
        res=c['result']; row={}
        for role,s in c['sessions'].items():
            acq=[b for b in s['broker'] if b['op']=='acquire']
            rel=[b for b in s['broker'] if b['op']=='release']
            tr=s.get('transcript') or res.get('bTranscriptAfterCancel') if role=='B' else s.get('transcript')
            ends=[t for t in (tr or []) if isinstance(t,dict) and t['type'] in ('turn_complete','turn_error')]
            row[role]={'acquire':len(acq),'acq409':sum(1 for b in acq if b['status']==409),
                'acqCodes':sorted(set(str(b.get('code')) for b in acq if b['status']!=200)),
                'acq200At':[b['at'] for b in acq if b['status']==200],
                'firstAcqAt':acq[0]['at'] if acq else None,
                'release':[(b['at'],b['status']) for b in rel],'droppedReleases':len(s['droppedReleases']),
                'settled':[(x['at'],x['payload'].get('outcome'),x['payload'].get('stopReason')) for x in s['settled']],
                'ends':ends,'mid':s.get('midQueueTranscript')}
        row['stderr']=[(x['at'],x['line'][:140]) for x in c['stderr']]
        row['result']={k:v for k,v in res.items() if k not in ('promptA','promptB','promptB1','promptB2','bTranscriptAfterCancel')}
        row['prompts']={k:(v['at'],v['status']) for k,v in res.items() if k.startswith('prompt')}
        out[c['name']]=row
    return out
for arm in sys.argv[1:]:
    print('=====',arm)
    for name,row in summ(arm).items():
        print('---',name)
        print(json.dumps(row,indent=None)[:4000])
