import subprocess, shutil, sys, json
MOD='/Users/wenshao/git/wt-pr12552-r3/packages/sdk-java/runtime-broker/'
P='src/main/java/com/alibaba/qwen/code/runtimebroker/'
RBS=MOD+P+'RuntimeBrokerService.java'; LP=MOD+P+'LocalProcessRuntimeProvisioner.java'
M=[
 ('M1 invalidateBinding skips releaseQuietly', RBS, '''        if (record.getLease() != null) {
            releaseQuietly(record.getRequest(), record.getLease());
        }''', ''),
 ('M2 release on dead lease back to 503 (requireUsableLease)', RBS, '''        if (!provisioner.isUsable(context.lease())) {
            return releaseUnusableSession(context);
        }''', '''        requireUsableLease(context);'''),
 ('M3 no invalidateBinding in local release', RBS, '''            SessionContext context) {
        invalidateBinding(context.binding());''', '''            SessionContext context) {'''),
 ('M4 local release drops the busy guard', RBS, '''            if (context.hasActiveControl()
                    || executionRepository.hasActiveByRuntimeSession(
                            context.session().getRuntimeSessionId())) {
                throw conflict("runtime_session_busy",
                        "Runtime Session has an active operation");
            }
            RuntimeSessionRecord releasing =
                    transitionSessionToReleasing(context);
            if (releasing.getState()
                    != RuntimeSessionRecord.State.RELEASED) {''', '''            RuntimeSessionRecord releasing =
                    transitionSessionToReleasing(context);
            if (releasing.getState()
                    != RuntimeSessionRecord.State.RELEASED) {'''),
 ('M5 local release ignores an in-flight release', RBS, '''            if (inFlight != null) {
                return inFlight;
            }''', ''),
 ('M6 local release keeps the context', RBS, '''                finishSessionRelease(releasing);
            }
            sessions.remove(context.session().getRuntimeSessionId());
            return CompletableFuture.completedFuture(true);''', '''                finishSessionRelease(releasing);
            }
            return CompletableFuture.completedFuture(true);'''),
 ('M7 local release skips finishSessionRelease', RBS, '''                finishSessionRelease(releasing);
            }
            sessions.remove(''', '''            }
            sessions.remove('''),
 ('M8 ready url: scheme check only', LP, '''            if (!"http".equals(endpoint.getScheme())
                    || !"127.0.0.1".equals(endpoint.getHost())) {''', '''            if (!"http".equals(endpoint.getScheme())) {'''),
 ('M9 ready url: host check only', LP, '''            if (!"http".equals(endpoint.getScheme())
                    || !"127.0.0.1".equals(endpoint.getHost())) {''', '''            if (!"127.0.0.1".equals(endpoint.getHost())) {'''),
]
res=[]
for name,f,old,new in M:
    src=open(f).read(); assert src.count(old)==1, name
    shutil.copy(f,f+'.bak'); open(f,'w').write(src.replace(old,new))
    try:
        r=subprocess.run(['mvn','-o','-q','test','-Dtest=RuntimeBrokerServiceTest,LocalProcessRuntimeProvisionerTest,HttpRuntimeTransportTest'],cwd=MOD,capture_output=True,text=True)
        out=r.stdout+r.stderr
        failed=sorted(set(l.split('[ERROR]')[1].strip().split(':')[0].split(' ')[0] for l in out.splitlines() if l.startswith('[ERROR]   ') and 'Test.' in l))
        killed = r.returncode!=0
        res.append((name, 'KILLED' if killed else 'survived', failed[:3]))
        print(res[-1], flush=True)
    finally:
        shutil.move(f+'.bak',f)
json.dump(res,open(sys.argv[1],'w'),indent=1)
