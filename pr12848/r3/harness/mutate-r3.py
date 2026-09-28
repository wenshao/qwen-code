import subprocess, re
SP='/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/a3d8cbe6-83a8-459a-99a4-f6d43fbc9c27/scratchpad'
WT=f'{SP}/wt-r4'
ENV={'JAVA_HOME':'/Users/wenshao/Install/jdk21','PATH':'/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:/usr/bin:/bin','HOME':'/Users/wenshao'}
F='packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerHttpServer.java'
MUT=[
 ('JM1','prepared no longer observed as live','                && ("prepared".equals(state) || "executing".equals(state)\n                    || "cancel_requested".equals(state))) {','                && ("executing".equals(state)\n                    || "cancel_requested".equals(state))) {'),
 ('JM2','observed status back to {state} only','            Map<String, Object> observedStatus = status(record);\n            observedStatus.put("state", state);\n            observedStatus.put("cancelRequested", record.isCancelRequested() || "cancel_requested".equals(state));\n            response.put("status", observedStatus);','            response.put("status", Map.of("state", state));'),
 ('JM3','cancelRequested not forced on cancel_requested','record.isCancelRequested() || "cancel_requested".equals(state)','record.isCancelRequested()'),
 ('JM4',':start no longer observes an UNKNOWN record','            complete(exchange, service.startExecution(harnessSessionId, runtimeSessionId, executionCallId, payload)\n                    .thenCompose(record -> observe(harnessSessionId, runtimeSessionId, record)),\n                    observation -> observedExecutionEnvelope(harnessSessionId, runtimeSessionId, observation));','            complete(exchange, service.startExecution(harnessSessionId, runtimeSessionId, executionCallId, payload),\n                    record -> executionEnvelope(harnessSessionId, runtimeSessionId, record));'),
]
for mid,desc,old,new in MUT:
    p=f'{WT}/{F}'; s=open(p).read(); n=s.count(old)
    if n!=1: print(mid,'SKIP',n); continue
    open(p,'w').write(s.replace(old,new))
    try:
        r=subprocess.run(['mvn','--batch-mode','--no-transfer-progress','-s',f'{SP}/m2settings.xml',f'-Dmaven.repo.local={SP}/m2repo','-Dcheckstyle.skip','-f','packages/sdk-java/runtime-broker/pom.xml','test','-Dtest=RuntimeBrokerHttpServerTest,HttpRuntimeTransportTest'],cwd=WT,capture_output=True,text=True,env=ENV)
        out=r.stdout+r.stderr
        tot=[l for l in out.splitlines() if re.search(r'Tests run: \d+, Failures',l) and ' in com' not in l]
        fails=sorted(set(re.findall(r'\[ERROR\]\s+(\w+Test\.\w+)',out)))
        print(mid, 'KILLED' if r.returncode else 'SURVIVED', desc, '|', (tot[-1].split('] ')[-1] if tot else 'compile?'), '|', ','.join(fails)[:200])
    finally:
        subprocess.run(['git','checkout','--',F],cwd=WT,check=True)
