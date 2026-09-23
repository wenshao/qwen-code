import subprocess, shutil, json, sys, os
ROOT='/root/verify/pr12506/packages/cli'
W=ROOT+'/src/serve/managed-runtime-attestation-worker.ts'
C=ROOT+'/src/cli.ts'
M=[
 ('M01','drop SIGTERM handler',W,"    process.once('SIGTERM', close);\n",""),
 ('M02','drop SIGINT handler',W,"    process.once('SIGINT', close);\n",""),
 ('M03','bind 0.0.0.0 (ready url still says 127.0.0.1)',W,"server.listen(0, '127.0.0.1');","server.listen(0, '0.0.0.0');"),
 ('M04','size cap > -> >= (exact 32 KiB rejected)',W,"size > MANAGED_RUNTIME_WORKER_BOOT_LIMIT_BYTES","size >= MANAGED_RUNTIME_WORKER_BOOT_LIMIT_BYTES"),
 ('M05','drop size cap',W,"    if (size > MANAGED_RUNTIME_WORKER_BOOT_LIMIT_BYTES) {\n      throw new Error(INVALID_BOOT_MESSAGE);\n    }\n",""),
 ('M06','drop version===1 check',W,"boot['type'] === 'boot' && boot['version'] === 1","boot['type'] === 'boot'"),
 ('M07','drop type===boot check',W,"boot['type'] === 'boot' && boot['version'] === 1","boot['version'] === 1"),
 ('M08','drop closed key-set check',W,"    keys.length !== BOOT_KEYS.length ||\n    !keys.every((key, index) => key === BOOT_KEYS[index])","    false"),
 ('M09','ready record leaks token',W,"    epoch: boot.epoch,\n    url:","    epoch: boot.epoch,\n    token: boot.token,\n    url:"),
 ('M10','ready line without newline',W,"`${JSON.stringify(worker.ready)}\\n`","JSON.stringify(worker.ready)"),
 ('M11','drop closeAllConnections',W,"        server.closeAllConnections();\n",""),
 ('M12','drop server timeouts',W,"  server.headersTimeout = 5_000;\n  server.requestTimeout = 5_000;\n  server.keepAliveTimeout = 1_000;\n",""),
 ('M13','drop maxHeadersCount',W,"  server.maxHeadersCount = 32;\n",""),
 ('M14','drop route gate (createServer(app))',W,"createServer(ownedManagedRuntimeRouteGate(app))","createServer(app)"),
 ('M15','accept extra argv',C,"    if (argv.length !== 1) {","    if (false) {"),
 ('M17','drop boot deadline (no race)',W,"    return await Promise.race([\n      collectManagedRuntimeWorkerBoot(input),\n      timedOut,\n    ]);","    void timedOut.catch(() => {});\n    return await collectManagedRuntimeWorkerBoot(input);"),
 ('M18','deadline 30 s -> 300 s',W,"MANAGED_RUNTIME_WORKER_BOOT_TIMEOUT_MS = 30_000","MANAGED_RUNTIME_WORKER_BOOT_TIMEOUT_MS = 300_000"),
 ('M19','deadline does not destroy stdin',W,"      input.destroy();\n",""),
 ('M20','deadline timer not unref()d',W,"    timeout.unref();\n",""),
 ('M16','ready omits epoch',W,"    epoch: boot.epoch,\n    url:","    url:"),
]
only=sys.argv[1:]
res=[]
for mid,desc,f,a,b in M:
    if only and mid not in only: continue
    src=open(f).read(); assert src.count(a)==1,(mid,src.count(a))
    shutil.copy(f,f+'.bak')
    try:
        open(f,'w').write(src.replace(a,b))
        tests=['src/serve/managed-runtime-attestation-worker.test.ts'] + (['src/cli.test.ts'] if f==C else [])
        out=f'/root/verify/pr12506-harness/mut/{mid}.json'
        subprocess.run(['npx','vitest','run',*tests,'--reporter=json','--outputFile='+out],cwd=ROOT,capture_output=True,env={**os.environ,'CI':'true'},timeout=300)
        j=json.load(open(out))
        failed=[t['title'] for r in j['testResults'] for t in r['assertionResults'] if t['status']!='passed']
        res.append((mid,desc,'KILLED' if failed or j['numFailedTestSuites'] else 'survived',failed))
    finally:
        shutil.move(f+'.bak',f)
    print(res[-1],flush=True)
json.dump(res,open('/root/verify/pr12506-harness/mut/summary-'+(os.environ.get('ARM','head'))+'.json','w'),indent=1)
