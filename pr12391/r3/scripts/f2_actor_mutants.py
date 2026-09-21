#!/usr/bin/env python3
"""Delete each clause arm F2 adds (owner, generation, the two backwards-rule disjuncts); run F2's own suite."""
import os, shutil, subprocess
SRC='/root/verify/pr12391-harness/r3/trees/F2/sdk-java'; W='/root/verify/pr12391-harness/r3/mutants/f2work'
R='runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/InMemoryToolExecutionRepository.java'
ENV=dict(os.environ, JAVA_HOME='/root/Install/jdk21', PATH='/root/Install/jdk21/bin:/root/Install/maven/bin:'+os.environ['PATH'])
M=[('A1','actor: owner clause',"\n                || !current.getDispatchOwner().equals(owner)",""),
   ('A2','actor: generation clause',"\n                || current.getDispatchGeneration() != dispatchGeneration",""),
   ('A3','rule: no move back to PREPARED',"        if (to == ToolExecutionRecord.State.PREPARED\n                || to == ToolExecutionRecord.State.DISPATCHING","        if (to == ToolExecutionRecord.State.DISPATCHING"),
   ('A4','rule: no move back to DISPATCHING',"                || to == ToolExecutionRecord.State.DISPATCHING\n                        && current.getState()\n                                != ToolExecutionRecord.State.DISPATCHING) {",") {")]
for mid,desc,old,new in M:
    d=os.path.join(W,mid); shutil.rmtree(d,ignore_errors=True); shutil.copytree(SRC,d,ignore=shutil.ignore_patterns('target'))
    p=os.path.join(d,R); s=open(p).read(); assert s.count(old)==1,(mid,s.count(old)); open(p,'w').write(s.replace(old,new))
    r=subprocess.run(['mvn','-o','-q','-B','-Djacoco.skip=true','test'],cwd=os.path.join(d,'runtime-broker'),env=ENV,capture_output=True,text=True)
    out=r.stdout+r.stderr; k=[l for l in out.splitlines() if l.startswith('[ERROR]   InMemoryRepositoryTest.')]
    print(mid, 'KILLED' if r.returncode and 'Tests run' in out else 'SURVIVED' if r.returncode==0 else 'OTHER', desc, ('<- '+k[0].split('InMemoryRepositoryTest.')[1].split(' ')[0]) if k else '')
    shutil.rmtree(d,ignore_errors=True)
