import os, shutil, json
SRC='/root/verify/pr13115/head/packages/sdk-java/runtime-broker'
M='src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java'
T='src/test/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerServiceTest.java'
orig=open(f'{SRC}/{M}').read()
probes=open('/root/verify/pr13115/r2/mut/probes_r1_ported.java.txt').read()
def nth(s,a,b,n=1):
    i=-1
    for _ in range(n):
        i=s.find(a,i+1); assert i>=0,(a[:60],n)
    return s[:i]+b+s[i+len(a):]
RS='''        BindingRenewal renewal = new BindingRenewal(claimed);
        renewal.start();
        return safeStage(step).toCompletableFuture()
                .orTimeout(stepCallTimeoutMillis(), TimeUnit.MILLISECONDS)
                .whenComplete((value, error) -> renewal.close())'''
MUT=[
 ('n01','renewingStep: never start its renewal', RS, RS.replace('        renewal.start();\n',''),1),
 ('n02','renewingStepOrNull: never start its renewal', RS, RS.replace('        renewal.start();\n',''),2),
 ('n03','renewingStep: keep ticking after the step', RS, RS.replace('\n                .whenComplete((value, error) -> renewal.close())',''),1),
 ('n04','renewingStepOrNull: keep ticking after the step', RS, RS.replace('\n                .whenComplete((value, error) -> renewal.close())',''),2),
 ('n05','step backstop back to lease-relative', 'return Math.max(1, operationDeadlineMillis() / 2);','return cleanupStepTimeoutMillis();',1),
 ('n06','renewingStep: drop the never-answering backstop', RS, RS.replace('\n                .orTimeout(stepCallTimeoutMillis(), TimeUnit.MILLISECONDS)',''),1),
 ('n07','maintenance attest leg unbounded', '''observed,
                                    cleanupStepTimeoutMillis())''','''observed,
                                    0)''',1),
 ('n08','finishLostRecovery with plain re-read (R1 m08)','executionRepository, renewRecoveryClaim(claimed));','executionRepository, bindingRepository.findById(claimed.getBindingId()));',1),
 ('n09','recoverBinding post-observation renew -> re-read (R1 m15)','RuntimeBindingRecord current = renewRecoveryClaim(claimed);','RuntimeBindingRecord current = bindingRepository.findById(claimed.getBindingId());',1),
 ('n10','recoverBinding outer backstop back to one lease (R1 m14)','orTimeout(operationDeadlineMillis(), TimeUnit.MILLISECONDS)','orTimeout(operationLeaseDuration.toMillis(), TimeUnit.MILLISECONDS)',1),
 ('n11','BindingRenewal: drop stopped check (R1 m16)','if (stopped.get() || closed.get()) {','if (closed.get()) {',1),
]
meta={'n00':'control'}
def copy(dst):
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(SRC,dst,ignore=shutil.ignore_patterns('target'))
    t=f'{dst}/{T}'; s=open(t).read()
    a='    private static class StaleBindingRepository'; assert s.count(a)==1
    s=s.replace(a, probes+a)
    with open(t,'w') as f: f.write(s)
copy('n00/runtime-broker')
for mid,desc,a,b,n in MUT:
    m=nth(orig,a,b,n); assert m!=orig
    copy(f'{mid}/runtime-broker')
    with open(f'{mid}/runtime-broker/{M}','w') as f: f.write(m)
    meta[mid]=desc
json.dump(meta,open('mutants.json','w'),indent=1)
print(len(meta))
