import os, re, shutil, subprocess, sys, json, glob, hashlib
MOD='/Users/wenshao/git/qwen-code-pr12552-r2-mut/packages/sdk-java/runtime-broker'
P='src/main/java/com/alibaba/qwen/code/runtimebroker/'
LP=P+'LocalProcessRuntimeProvisioner.java'; SVC=P+'RuntimeBrokerService.java'
M={
 'N01 confirm failure does not retire the binding':(SVC,'''                        } else {
                            invalidateBinding(record);
                            confirmed.completeExceptionally(unwrap(error));''','''                        } else {
                            confirmed.completeExceptionally(unwrap(error));'''),
 'N02 invalidateBinding does not fail the record':(SVC,'''        if (claimed != null) {
            failBinding(claimed);
        }
    }

    private void requireUsableLease''','''    }

    private void requireUsableLease'''),
 'N03 control skips the liveness check':(SVC,'''                        requireUsableLease(context);
                        result = mapFailure''','''                        result = mapFailure'''),
 'N04 cancel skips the liveness check':(SVC,'''                    requireUsableLease(context);
                    return mapFailure(safeStage(() -> transport.cancel(''','''                    return mapFailure(safeStage(() -> transport.cancel('''),
 'N05 release skips the liveness check':(SVC,'''            SessionContext context) {
        requireUsableLease(context);''','''            SessionContext context) {'''),
 'N06 dispatch skips the liveness check':(SVC,'''        if (!provisioner.isUsable(context.lease())) {
            invalidateBinding(context.binding());
            markUnknown''','''        if (false) {
            invalidateBinding(context.binding());
            markUnknown'''),
 'N07 fenced (claim expired) does not release':(SVC,'''                    if (currentClaim == null) {
                        releaseQuietly(claimed.getRequest(), lease);''','''                    if (currentClaim == null) {'''),
 'N08 fenced (CAS lost) does not release':(SVC,'''                    if (ready == null) {
                        releaseQuietly(claimed.getRequest(), lease);''','''                    if (ready == null) {'''),
 'N09 service.close does not close provisioner':(SVC,'''        scheduler.shutdownNow();
        provisioner.close();''','''        scheduler.shutdownNow();'''),
 'N10 start() finally never kills':(LP,'if (!adopted && ownedProcess != null) {','if (false) {'),
 'N11 ready record unbounded':(LP,'''                if (bounded) {
                    throw''','''                if (false) {
                    throw'''),
 'N12 no stdout drain after ready':(LP,'''                while (readLine(input, false) != null) {''','''                while (readLine(input, false) != null && false) {'''),
 'N13 capabilityDigest unchecked':(LP,'''            if (!CAPABILITY_DIGEST.matcher(scope.getCapabilityDigest())
                    .matches()) {''','''            if (false) {'''),
 'N14 attest flattens transport failures to 503':(LP,'''            if (exception
                    .getCause() instanceof RuntimeBrokerException failure) {
                throw failure;
            }
            throw failed("Managed Runtime attestation failed.", exception);''','''            throw failed("Managed Runtime attestation failed.", exception);'''),
 'N15 isUsable ignores isAlive':(LP,'return process != null && process.process.isAlive();','return process != null;'),
 'N16 release() keeps the process':(LP,'''            RuntimeLease lease) {
        stop(lease);
        return CompletableFuture.completedFuture(null);''','''            RuntimeLease lease) {
        return CompletableFuture.completedFuture(null);'''),
}
only=sys.argv[1:]; res={}; hashes=set()
for name,(f,a,b) in M.items():
    key=name.split()[0]
    if only and key not in only: continue
    path=f'{MOD}/{f}'; orig=open(path).read(); assert orig.count(a)==1,(name,orig.count(a))
    shutil.copy(path, path+'.bak')
    try:
        mutated=orig.replace(a,b); open(path,'w').write(mutated)
        h=hashlib.sha1(mutated.encode()).hexdigest()[:8]; assert h not in hashes; hashes.add(h)
        for g in glob.glob(MOD+'/target/surefire-reports/*'): os.remove(g)
        r=subprocess.run(f'cd {MOD} && mvn -q -o test',shell=True,capture_output=True,text=True)
        fails=[]
        for rep in glob.glob(MOD+'/target/surefire-reports/*.txt'):
            t=open(rep).read()
            if re.search(r'(Failures|Errors): [1-9]',t):
                fails+=[os.path.basename(rep).split('.')[-2]+':'+m for m in re.findall(r'\.(\w+) -- Time elapsed.*?<<< (?:FAILURE|ERROR)',t)] or [os.path.basename(rep).split('.')[-2]]
        out=r.stdout+r.stderr
        if 'COMPILATION ERROR' in out: v='COMPILE-ERR'
        elif r.returncode: v='KILLED by '+', '.join(sorted(set(fails)))[:160]
        else: v='SURVIVED'
    finally:
        shutil.move(path+'.bak', path)
    res[key]={'name':name,'sha':h,'result':v}
    print(key,name,'|',h,'|',v,flush=True)
json.dump(res,open(os.environ['OUTJSON'],'w'),indent=1)
