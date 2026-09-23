import os, re, shutil, subprocess, sys, json
SRC=os.environ.get('SRC','/root/verify/pr12552/packages/sdk-java/runtime-broker')
ROOT=os.environ.get('ROOT','/root/verify/pr12552-mut')
P='src/main/java/com/alibaba/qwen/code/runtimebroker/'
LP=P+'LocalProcessRuntimeProvisioner.java'; SVC=P+'RuntimeBrokerService.java'
M={
 'M01 service: no confirm on READY (base behaviour)':(SVC,'return safeStage(() -> provisioner.confirm(request, live.lease()))\n                    .thenApply(ignored -> live);','return CompletableFuture.completedFuture(live);'),
 'M02 provisioner.confirm is a no-op':(LP,'return CompletableFuture.runAsync(() -> attestOwned(request, lease),\n                executor);','return CompletableFuture.completedFuture(null);'),
 'M03 no attestation before READY':(LP,'            attest(request, ownedProcess.seed, lease);\n            owned.put','            owned.put'),
 'M04 ready: runtimeInstanceId unchecked':(LP,'|| !runtimeInstanceId.equals(\n                            ready.get("runtimeInstanceId"))',''),
 'M05 ready: runtimeIncarnation unchecked':(LP,'|| !runtimeIncarnation.equals(\n                            ready.get("runtimeIncarnation"))',''),
 'M06 ready: leaseId unchecked':(LP,'|| !leaseId.equals(ready.get("leaseId"))',''),
 'M07 ready: epoch unchecked':(LP,'\n                    || !Long.valueOf(1L).equals(number(ready.get("epoch")))',''),
 'M08 ready: type/version unchecked':(LP,'if (!"ready".equals(ready.get("type"))\n                    || !Long.valueOf(1L).equals(number(ready.get("version")))\n                    ||','if ('),
 'M09 failure path keeps the process':(LP,'        } catch (RuntimeException exception) {\n            if (ownedProcess != null) {\n                ownedProcess.process.destroy();\n            }','        } catch (RuntimeException exception) {\n            if (ownedProcess != null) {\n            }'),
 'M10 stop() does not end the process':(LP,'        if (process != null) {\n            process.process.destroy();\n        }\n    }\n\n    @Override','        if (process != null) {\n        }\n    }\n\n    @Override'),
 'M11 close() does not end processes':(LP,'        for (OwnedProcess process : owned.values()) {\n            process.process.destroy();\n        }','        for (OwnedProcess process : owned.values()) {\n        }'),
 'M12 attestOwned skips isAlive':(LP,'if (process == null || !process.process.isAlive()) {','if (process == null) {'),
 'M13 ready timeout does not kill':(LP,'            process.destroyForcibly();\n            throw failed("Managed Runtime worker did not become ready.",','            throw failed("Managed Runtime worker did not become ready.",'),
 'M14 execute posts to the attest route':('src/main/java/com/alibaba/qwen/code/runtimebroker/HttpRuntimeTransport.java','"/internal/managed-runtime/v2/execute"','"/internal/managed-runtime/v2/nope"'),
}
TESTS='LocalProcessRuntimeProvisionerTest,RuntimeBrokerServiceTest,HttpRuntimeTransportTest'
res={}
only=sys.argv[1:] 
for i,(name,(f,a,b)) in enumerate(M.items()):
    key=name.split()[0]
    if only and key not in only: continue
    d=f'{ROOT}/{key}/packages/sdk-java/runtime-broker'
    if not os.path.isdir(d):
        os.makedirs(f'{ROOT}/{key}/packages',exist_ok=True)
        os.symlink('/root/verify/pr12552/packages/cli',f'{ROOT}/{key}/packages/cli')
        shutil.copytree(SRC,d,ignore=shutil.ignore_patterns('target'))
        path=f'{d}/{f}'; s=open(path).read()
        assert s.count(a)==1,(name,s.count(a)); open(path,'w').write(s.replace(a,b))
    r=subprocess.run(f'cd {d} && mvn -q -o test -Dtest={TESTS} -Dsurefire.failIfNoSpecifiedTests=false',shell=True,capture_output=True,text=True)
    import glob
    fails=[os.path.basename(f).split('.')[-2] for f in glob.glob(d+'/target/surefire-reports/*.txt') if re.search(r'(Failures|Errors): [1-9]',open(f).read())]
    pr=('KILLED by '+','.join(fails)) if r.returncode else 'survived'
    if 'COMPILATION ERROR' in r.stdout+r.stderr or not glob.glob(d+'/target/surefire-reports/*.txt'): pr='COMPILE-ERR/NO-RUN'
    e2e='' if os.environ.get('NOHARNESS') else subprocess.run(f'/root/verify/pr12552-harness/run.sh {d} > {d}/e2e.out 2>&1; CLS=BadWorkerE2E /root/verify/pr12552-harness/run.sh {d} > {d}/bad.out 2>&1; grep -h ^FAIL {d}/e2e.out {d}/bad.out',shell=True,capture_output=True,text=True).stdout
    res[key]={'name':name,'prTests':pr,'e2eFails':[l.split(' ::')[0][5:] for l in e2e.splitlines()]}
    print(key, name, '| PR tests:', pr, '| real-worker harness FAIL:', res[key]['e2eFails'], flush=True)
json.dump(res,open(f'/root/verify/pr12552-harness/mut/result-{os.environ.get('TAG','')}{"-".join(only) or "all"}.json','w'),indent=1)
