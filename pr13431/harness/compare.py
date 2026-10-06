import json, sys
arms = sys.argv[1:] or ['base-probe', 'head-probe']
for d in ['latency', 'process-crash', 'shell-output', 'store-failure', 'workspace-tool-turn']:
    for a in arms:
        r = json.load(open(f'/root/pr13431-rig/out/{a}/probe/summary.json')).get(d)
        if not r:
            print(f'{d:20s} {a}: (no data)'); continue
        print(f"{d:20s} {a:11s} ka={r['keepAliveSeen']} reuses={r['reuses']} maxIdle={r['reuseIdleMaxMs']} >3s={r['reuseIdleOver3s']} >5s={r['reuseIdleOver5s']} closedBy={r['closedBy']} clientMed={r['clientCloseIdleMedianMs']} serverMed={r['serverCloseIdleMedianMs']} storeErr={len(r['storeErrors'])} lag={r['lagInjections']}")
