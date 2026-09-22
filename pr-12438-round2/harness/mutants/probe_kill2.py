#!/usr/bin/env python3
"""For each mutant that survived the PR tests, compile it and diff ServiceProbe output against the unmutated baseline."""
import os, re, sys, shutil, subprocess, concurrent.futures as cf
sys.argv = [sys.argv[0]]
import mutants2 as MU
H = '/root/verify/pr12438-r2-harness'
SRC = H + '/sdk-java'
WORK = H + '/mutants/work-probe2'
ENV = MU.ENV
CP_EXTRA = '/root/.m2/repository/com/h2database/h2/2.3.232/h2-2.3.232.jar'
def norm(text):
    text = re.sub(r'\x1b\[[0-9;]*m', '', text)
    text = re.sub(r'after [0-9]+ ms', 'after N ms', text)
    text = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'UUID', text)
    return text
def probe(modroot, tag):
    out = os.path.join(WORK, 'cls-' + tag); shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    cp = os.path.join(modroot, 'runtime-broker/target/classes') + ':' + CP_EXTRA
    srcs = [os.path.join(H, 'probes/src/com/alibaba/qwen/code/runtimebroker', f) for f in ('ProbeKit.java', 'ServiceProbe.java', 'R2Probe.java')]
    subprocess.run(['/root/Install/jdk21/bin/javac', '-nowarn', '-d', out, '-cp', cp] + srcs, check=True, capture_output=True)
    r = subprocess.run(['/root/Install/jdk21/bin/java', '-cp', out + ':' + cp, 'com.alibaba.qwen.code.runtimebroker.ServiceProbe'], capture_output=True, text=True, timeout=120); r2 = subprocess.run(['/root/Install/jdk21/bin/java', '-cp', out + ':' + cp, 'com.alibaba.qwen.code.runtimebroker.R2Probe'], capture_output=True, text=True, timeout=120)
    return norm(r.stdout + r.stderr + r2.stdout + r2.stderr)
def build(d):
    subprocess.run(['mvn', '-o', '-q', '-B', '-Djacoco.skip=true', 'compile'], cwd=os.path.join(d, 'runtime-broker'), env=ENV, check=True, capture_output=True)
def run(m, base):
    mid = m[0]; old, new = m[3], m[4]
    d = os.path.join(WORK, mid); shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns('target'))
    p = os.path.join(d, MU.S); s = open(p).read(); open(p, 'w').write(s.replace(old, new))
    build(d)
    try:
        got = probe(d, mid)
    except Exception as e:
        got = 'PROBE CRASH ' + str(e)
    changed = [l for l in got.splitlines() if l not in base.splitlines()]
    shutil.rmtree(d, ignore_errors=True)
    return mid, changed
if __name__ == '__main__':
    survivors = [l.split('\t')[0] for l in open(H + '/mutants/run-head.log') if '\tSURVIVED\t' in l]
    os.makedirs(WORK, exist_ok=True)
    base = probe(SRC, 'base')
    base2 = probe(SRC, 'base2')
    flaky = set(base.splitlines()) ^ set(base2.splitlines())
    todo = [m for m in MU.M if m[0] in survivors]
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda m: run(m, base), todo))
    killed = 0
    for mid, changed in res:
        changed = [c for c in changed if c not in flaky]
        desc = next(m[2] for m in MU.M if m[0] == mid)
        if changed:
            killed += 1
            print(f"{mid}\tPROBE-KILLED\t{desc}\t| " + ' || '.join(c.strip()[:150] for c in changed[:2]))
        else:
            print(f"{mid}\tstill-survives\t{desc}")
    print(f"# probes kill {killed}/{len(res)} PR-test survivors")
