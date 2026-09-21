#!/usr/bin/env python3
"""Guard-deletion mutants on the lines 25a38c3 adds; run the PR's own 18 tests (mvn -o test, JDK 21).
Also records which mutants change the PlanMatrixProbe3 outcome (behavioural reach via real snapshots)."""
import os, shutil, subprocess, concurrent.futures as cf
SRC = '/root/verify/pr12391-harness/r3/trees/head/sdk-java'
WORK = '/root/verify/pr12391-harness/r3/mutants/work'
PROBE = '/root/verify/pr12391-harness/r3/probes/out'
R = 'runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/InMemoryToolExecutionRepository.java'
T = 'runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/ToolExecutionRecord.java'
M = [
 ('N01', 'CAS: refuse when current is UNKNOWN — deleted', R,
  "                || current.getState() == ToolExecutionRecord.State.UNKNOWN\n                || !current.sameDispatch(expected)",
  "                || !current.sameDispatch(expected)"),
 ('N02', 'CAS: current.sameDispatch(expected) — deleted', R,
  "                || !current.sameDispatch(expected)\n", ""),
 ('N03', 'CAS: hasLiveDispatchAt(now) — deleted', R,
  "\n                || !current.hasLiveDispatchAt(clock.instant())) {", ") {"),
 ('N04', 'requireReplacement: expected.sameDispatch(replacement) — deleted', R,
  "                || !expected.sameDispatch(replacement)\n", ""),
 ('N05', 'requireReplacement: cancel-drop refusal — deleted', R,
  "        if (expected.isCancelRequested()\n                && !replacement.isCancelRequested()) {",
  "        if (false && expected.isCancelRequested()\n                && !replacement.isCancelRequested()) {"),
 ('N06', 'claimDispatch: EXECUTING takeover -> UNKNOWN — EXECUTING disjunct deleted', R,
  "        if (current.getState() == ToolExecutionRecord.State.EXECUTING\n                || current.getState()\n                        == ToolExecutionRecord.State.CANCEL_REQUESTED) {",
  "        if (current.getState()\n                        == ToolExecutionRecord.State.CANCEL_REQUESTED) {"),
 ('N07', 'claimDispatch: CANCEL_REQUESTED takeover -> UNKNOWN — disjunct deleted', R,
  "        if (current.getState() == ToolExecutionRecord.State.EXECUTING\n                || current.getState()\n                        == ToolExecutionRecord.State.CANCEL_REQUESTED) {",
  "        if (current.getState() == ToolExecutionRecord.State.EXECUTING) {"),
 ('N08', 'withUnknown: keep claim reverted to clearing it', T,
  "                cancelRequested, dispatchOwner, dispatchLeaseUntil,\n                dispatchGeneration, version, null);\n    }\n\n    public ToolExecutionRecord resolveUnknown(",
  "                cancelRequested, null, null,\n                dispatchGeneration, version, null);\n    }\n\n    public ToolExecutionRecord resolveUnknown("),
 ('N09', 'requestCancel: expectedVersion check — deleted', R,
  "        if (current == null || current.isSettled()\n                || current.getVersion() != expectedVersion) {",
  "        if (current == null || current.isSettled()) {"),
 ('N10', 'requestCancel: settled check — deleted', R,
  "        if (current == null || current.isSettled()\n                || current.getVersion() != expectedVersion) {",
  "        if (current == null\n                || current.getVersion() != expectedVersion) {"),
 ('N11', 'requestCancel: idempotent early return — deleted', R,
  "        if (current.isCancelRequested()) {\n            return current;\n        }\n        ToolExecutionRecord requested",
  "        ToolExecutionRecord requested"),
 ('N12', 'requestCancel: EXECUTING -> CANCEL_REQUESTED — state kept instead', R,
  "                current.getState() == ToolExecutionRecord.State.EXECUTING\n                        ? ToolExecutionRecord.State.CANCEL_REQUESTED\n                        : current.getState(),",
  "                current.getState(),"),
 ('N13', 'requestCancel: PREPARED settles immediately — deleted', R,
  "        if (current.getState() == ToolExecutionRecord.State.PREPARED) {\n            // Never",
  "        if (false && current.getState() == ToolExecutionRecord.State.PREPARED) {\n            // Never"),
 ('N14', 'resolveUnknown(repo): sameIdentity — deleted', R,
  "        if (current == null || !current.sameIdentity(expected)\n                || current.getVersion() != expected.getVersion()\n                || current.getState()\n                        != ToolExecutionRecord.State.UNKNOWN) {",
  "        if (current == null\n                || current.getVersion() != expected.getVersion()\n                || current.getState()\n                        != ToolExecutionRecord.State.UNKNOWN) {"),
 ('N15', 'resolveUnknown(repo): version check — deleted', R,
  "        if (current == null || !current.sameIdentity(expected)\n                || current.getVersion() != expected.getVersion()\n                || current.getState()\n                        != ToolExecutionRecord.State.UNKNOWN) {",
  "        if (current == null || !current.sameIdentity(expected)\n                || current.getState()\n                        != ToolExecutionRecord.State.UNKNOWN) {"),
 ('N16', 'resolveUnknown(repo): state == UNKNOWN check — deleted', R,
  "                || current.getVersion() != expected.getVersion()\n                || current.getState()\n                        != ToolExecutionRecord.State.UNKNOWN) {\n            return null;\n        }\n        ToolExecutionRecord resolved",
  "                || current.getVersion() != expected.getVersion()) {\n            return null;\n        }\n        ToolExecutionRecord resolved"),
 ('N17', 'resolveUnknown(repo): expected-null guard — deleted', R,
  "        if (expected == null) {\n            throw new IllegalArgumentException(\"expected is required\");\n        }\n",
  ""),
]
ENV = dict(os.environ, JAVA_HOME='/root/Install/jdk21', PATH='/root/Install/jdk21/bin:/root/Install/maven/bin:' + os.environ['PATH'])

def run(m):
    mid, desc, rel, old, new = m
    d = os.path.join(WORK, mid)
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns('target'))
    p = os.path.join(d, rel); s = open(p).read(); n = s.count(old)
    if n != 1:
        return (mid, desc, f'BAD_PATTERN({n})', '', '')
    open(p, 'w').write(s.replace(old, new))
    r = subprocess.run(['mvn', '-o', '-q', '-B', '-Djacoco.skip=true', 'test'], cwd=os.path.join(d, 'runtime-broker'),
                       env=ENV, capture_output=True, text=True)
    out = r.stdout + r.stderr
    verdict = ('COMPILE_ERROR' if 'COMPILATION ERROR' in out else 'SURVIVED' if r.returncode == 0
               else 'KILLED' if 'Tests run:' in out else f'INFRA({r.returncode})')
    killer = ''
    for line in out.splitlines():
        if line.startswith('[ERROR]   InMemoryRepositoryTest.'):
            killer = line.split('InMemoryRepositoryTest.')[1].split(' ')[0]; break
    # behavioural reach: does the matrix outcome change? (needs compiled classes: run test-compile output)
    classes = os.path.join(d, 'runtime-broker/target/classes')
    if not os.path.isdir(classes):
        subprocess.run(['mvn', '-o', '-q', '-B', '-Djacoco.skip=true', 'compile'], cwd=os.path.join(d, 'runtime-broker'), env=ENV, capture_output=True)
    mx = subprocess.run(['/root/Install/jdk21/bin/java', '-cp', PROBE + ':' + classes,
                         'com.alibaba.qwen.code.runtimebroker.PlanMatrixProbe3', mid], capture_output=True, text=True).stdout
    open(os.path.join(WORK, mid + '.matrix.tsv'), 'w').write(mx)
    shutil.rmtree(os.path.join(d, 'runtime-broker/src'), ignore_errors=True)
    return (mid, desc, verdict, killer, mx)

if __name__ == '__main__':
    os.makedirs(WORK, exist_ok=True)
    base = {l.split('\t')[0]: l.split('\t')[1] for l in open('/root/verify/pr12391-harness/r3/logs/matrix3-25a38c3.tsv') if not l.startswith('#')}
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(run, M))
    for mid, desc, v, killer, mx in res:
        rows = {l.split('\t')[0]: l.split('\t')[1] for l in mx.splitlines() if l and not l.startswith('#')}
        changed = [k for k in base if rows.get(k) != base[k]]
        print(f"{mid}  {v:10s} {desc}" + (f"  <- {killer}" if killer else "") + f"   | matrix rows changed: {', '.join(f'{k}:{base[k]}->{rows.get(k)}' for k in changed) or 'none'}")
    print(f"killed {sum(r[2]=='KILLED' for r in res)}/{len(res)}")
