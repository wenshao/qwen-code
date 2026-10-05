import json,sys,os
for run in sys.argv[1:]:
    o=f'/root/verify/pr13289/runs/{run}/out'
    p1=json.load(open(f'{o}/phase1/driver-phase1-results.json'))
    p2=json.load(open(f'{o}/phase2/driver-phase2-results.json'))
    b1=json.load(open(f'{o}/phase1/bindings-phase1.json'))
    b2=json.load(open(f'{o}/phase2/bindings-phase2.json'))
    probe=json.load(open(f'{o}/phase2/placement-probe.json'))
    db=open(f'{o}/mvn-phase1.log').read().split('VERIFY13289_DATABASE phase=1 ')[1].split('\n')[0][:80]
    print(f'===== {run}: {db}')
    for c in ('warmreg','warmnoreg','toolfirst'):
        r=p1[c]
        t1=r['afterTurn1']
        reg=r.get('register')
        regs='-' if reg is None else ('ok' if reg['exit']==0 else 'refused:'+(reg['stderr'][0].split(': ',1)[-1] if reg['stderr'] else '?'))
        ops=','.join(f"{x['op']}{x['status']}" for x in r['warmOps'])
        t2=r.get('turn2tool')
        t2s='-' if not t2 else ','.join(f"{x['op']}{x['status']}:{x.get('code','')}" for x in t2['broker'])
        insp=r.get('operatorInspect')
        inss='-' if not insp else (insp['stderr'][0].split(': ',1)[-1] if insp['stderr'] else 'exit%d'%insp['exit'])
        a=[x for x in b1 if x['storage_id']=='storage-'+c]
        bb=[x for x in b2 if x['storage_id']=='storage-'+c and x['provisioner_kind']=='local-process']
        orig=[x for x in bb if x['binding_id']==a[0]['binding_id']][0]
        s2=p2[c]['session2text']['broker']
        s2s=','.join(f"{x['op']}{x['status']}:{x.get('code','')}" for x in s2) or '(warm not recorded)'
        pr=[x for x in probe if x['case']==c][0]
        print(f"  {c:9} turn1 ops={ops} leaseRows={len(t1['localLeaseRows'])} csiRegister={regs} turn2={t2s}")
        print(f"            bootA: {a[0]['binding_state']} loss={a[0]['loss_source']} stop={a[0]['stop_source']} v{a[0]['record_version']} operatorInspect={inss}")
        print(f"            bootB: original={orig['binding_state']} loss={orig['loss_source']} stop={orig['stop_source']} v{orig['record_version']}; session2 {s2s} ready={p2[c]['ready']}")
        print(f"            probe: csi={pr['kubernetes-workspace']} local={pr['local-process']}")
    print('  bootB transitions:', json.dumps(p2['bootB']['transitions'])[:400])
