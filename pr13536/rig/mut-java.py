#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13536): Java mutation run on the pr13536-mut worktree.
# For each mutant: patch ManagedExtensionRecords.java, run the PR's 3 Java suites with Maven
# (offline), then re-evaluate the differential corpus with the mutant classes first on the
# classpath and compare row by row with the head Java verdicts.
import subprocess, sys, json, os, re, glob
sys.path.insert(0, '/Users/wenshao/git/pr13536-rig')
from mutants import JAVA
W = '/Users/wenshao/git/pr13536-mut'; R = '/Users/wenshao/git/pr13536-rig'; D = R + '/diff'
M = W + '/packages/sdk-java/managed-agent-server'
SRC = M + '/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.java'
M2 = '/Users/wenshao/git/pr13505-rig/m2'
src0 = open(SRC).read()
env = {k: v for k, v in os.environ.items() if 'proxy' not in k.lower()}
env['JAVA_HOME'] = '/Users/wenshao/Install/jdk21'; env['PATH'] = '/Users/wenshao/Install/jdk21/bin:' + env['PATH']
only = sys.argv[1:]
def verdicts(path):
    out = []
    with open(path) as f:
        for l in f:
            t = json.loads(l)
            out.append((t.get('read'), t.get('ok'), t.get('start'), t.get('succ'), t.get('task'), t.get('rid')))
    return out
head = verdicts(D + '/java-head-corpus.jsonl')
res = open(R + '/results/mut-java.tsv', 'a')
for mid, old, new in JAVA:
    if only and mid not in only: continue
    try:
        assert src0.count(old) == 1, mid
        open(SRC, 'w').write(src0.replace(old, new))
        for f in glob.glob(M + '/target/surefire-reports/*'): os.remove(f)
        p = subprocess.run(['mvn', '-B', '-ntp', '-o', f'-Dmaven.repo.local={M2}', '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true',
            '-Djacoco.skip=true', '-Dtest=ManagedAutomationRecordContractTest,ManagedExtensionProjectionContractTest,ManagedExtensionRecordStoreTest',
            '-Dsurefire.failIfNoSpecifiedTests=false', 'test'], cwd=M, capture_output=True, text=True, env=env)
        sums = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', p.stdout, re.M)
        tot = sums[-1] if sums else None
        failed = re.findall(r'\[ERROR\]\s+(\S+\.\S+:\d+|\S+)\s+»', p.stdout)[:3] or re.findall(r'<<< (?:FAILURE|ERROR)!\s*$', p.stdout, re.M)[:1]
        compiled = 'COMPILATION ERROR' not in p.stdout
        killed = p.returncode != 0
        changed = 'n/a'
        if compiled:
            CP = f'{D}/jcls-head:{M}/target/classes:{R}/jx-head/BOOT-INF/classes:{R}/jx-head/BOOT-INF/lib/*'
            q = subprocess.run(['java', '-Xmx4g', '-cp', CP, 'JavaEval', D + '/corpus.jsonl', D + f'/java-mut-{mid}.jsonl'], capture_output=True, text=True, env=env)
            if q.returncode == 0:
                mv = verdicts(D + f'/java-mut-{mid}.jsonl'); changed = sum(1 for a, b in zip(head, mv) if a != b)
                os.remove(D + f'/java-mut-{mid}.jsonl')
            else: changed = 'EVAL-FAIL ' + q.stderr[-200:]
        line = f'{mid}\t{"KILLED" if killed else "SURVIVED"}\tcompiled={compiled}\trun/fail/err={tot}\tcorpusRowsChanged={changed}\t{";".join(failed)}'
        print(line, flush=True); res.write(line + '\n'); res.flush()
    finally:
        open(SRC, 'w').write(src0)
