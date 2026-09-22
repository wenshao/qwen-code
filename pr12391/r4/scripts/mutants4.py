#!/usr/bin/env python3
"""R4: delete each guard in 4ddb2c3 (new ones + the ones deferred to the tracking issue), run the PR's 25 tests."""
import os, shutil, subprocess, concurrent.futures as cf
SRC = '/root/verify/pr12391-harness/r4/trees/head/sdk-java'
WORK = '/root/verify/pr12391-harness/r4/mutants/work'
PKG = 'runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/'
R = PKG + 'InMemoryToolExecutionRepository.java'; T = PKG + 'ToolExecutionRecord.java'; B = PKG + 'BrokerValues.java'
M = [
 ('G01', 'new', 'compareAndSet: caller owner must match', R, "\n                || !current.getDispatchOwner().equals(owner)", ""),
 ('G02', 'new', 'compareAndSet: caller generation must match', R, "\n                || current.getDispatchGeneration() != dispatchGeneration", ""),
 ('G03', 'new', 'no move back to PREPARED', R,
  "        if (to == ToolExecutionRecord.State.PREPARED\n                || to == ToolExecutionRecord.State.DISPATCHING",
  "        if (to == ToolExecutionRecord.State.DISPATCHING"),
 ('G04', 'new', 'no move to DISPATCHING from another state', R,
  "                || to == ToolExecutionRecord.State.DISPATCHING\n                        && current.getState()\n                                != ToolExecutionRecord.State.DISPATCHING) {", ") {"),
 ('G05', 'new', 'cancel flag sticky (stored record)', R,
  "        if (current.isCancelRequested()\n                && !replacement.isCancelRequested()) {",
  "        if (false && current.isCancelRequested()\n                && !replacement.isCancelRequested()) {"),
 ('G06', 'new', 'requireReplacement: lastSequence not below expected', R,
  "\n                || replacement.getLastSequence()\n                        < expected.getLastSequence()) {", ") {"),
 ('G07', 'new', 'requireCandidate: lastSequence == 0', R, "\n                || candidate.getLastSequence() != 0", ""),
 ('G08', 'new', 'ctor: CANCEL_REQUESTED requires cancelRequested', T,
  "        if (state == State.CANCEL_REQUESTED && !cancelRequested) {", "        if (false) {"),
 ('G09', 'new', 'resolveUnknown keeps the last claim', T,
  "                lastSequence, cancelRequested, dispatchOwner,\n                dispatchLeaseUntil, dispatchGeneration, version,\n                resolutionTime);",
  "                lastSequence, cancelRequested, null,\n                null, dispatchGeneration, version,\n                resolutionTime);"),
 ('G10', 'new', 'immutable JSON scalars only (Number allowlist)', B,
  "        if (value == null || value instanceof String || value instanceof Boolean\n",
  "        if (value == null || value instanceof String || value instanceof Boolean || value instanceof Number\n"),
 ('G11', 'new', 'non-String nested key -> IllegalArgumentException', B,
  "                throw new IllegalArgumentException(\n                        \"map key must be a string\");", "                continue;"),
 ('D01', 'deferred', 'compareAndSet refuses a current UNKNOWN record (N01)', R,
  "                || current.getState() == ToolExecutionRecord.State.UNKNOWN\n", ""),
 ('D02', 'deferred', 'requireReplacement: replacement keeps the claim (N04)', R,
  "                || !expected.sameDispatch(replacement)\n", ""),
 ('D03', 'deferred', 'CANCEL_REQUESTED takeover -> UNKNOWN (N07)', R,
  "        if (current.getState() == ToolExecutionRecord.State.EXECUTING\n                || current.getState()\n                        == ToolExecutionRecord.State.CANCEL_REQUESTED) {",
  "        if (current.getState() == ToolExecutionRecord.State.EXECUTING) {"),
 ('D04', 'deferred', 'requestCancel: expectedVersion check (N09)', R,
  "        if (current == null || current.isSettled()\n                || current.getVersion() != expectedVersion) {",
  "        if (current == null || current.isSettled()) {"),
 ('D05', 'deferred', 'renewDispatch: owner check', R,
  "        if (!ownerId.equals(current.getDispatchOwner())\n                || dispatchGeneration", "        if (false\n                || dispatchGeneration"),
 ('D06', 'deferred', 'renewDispatch: generation check', R,
  "\n                || dispatchGeneration != current.getDispatchGeneration()\n                || !current.getDispatchLeaseUntil().isAfter(now)) {\n            return null;\n        }\n        ToolExecutionRecord renewed",
  "\n                || !current.getDispatchLeaseUntil().isAfter(now)) {\n            return null;\n        }\n        ToolExecutionRecord renewed"),
]
ENV = dict(os.environ, JAVA_HOME='/root/Install/jdk21', PATH='/root/Install/jdk21/bin:/root/Install/maven/bin:' + os.environ['PATH'])
def run(m):
    mid, kind, desc, rel, old, new = m
    d = os.path.join(WORK, mid); shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns('target'))
    p = os.path.join(d, rel); s = open(p).read(); n = s.count(old)
    if n != 1:
        return (mid, kind, desc, f'BAD_PATTERN({n})', '')
    open(p, 'w').write(s.replace(old, new))
    r = subprocess.run(['mvn', '-o', '-q', '-B', '-Djacoco.skip=true', 'test'], cwd=os.path.join(d, 'runtime-broker'), env=ENV, capture_output=True, text=True)
    out = r.stdout + r.stderr
    v = 'COMPILE_ERROR' if 'COMPILATION ERROR' in out else 'SURVIVED' if r.returncode == 0 else 'KILLED' if 'Tests run:' in out else f'INFRA({r.returncode})'
    k = next((l.split('InMemoryRepositoryTest.')[1].split(' ')[0] for l in out.splitlines() if l.startswith('[ERROR]   InMemoryRepositoryTest.')), '')
    shutil.rmtree(d, ignore_errors=True)
    return (mid, kind, desc, v, k)
if __name__ == '__main__':
    os.makedirs(WORK, exist_ok=True)
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(run, M))
    for mid, kind, desc, v, k in res:
        print(f"{mid}\t{kind}\t{v}\t{desc}\t{k}")
    for kind in ('new', 'deferred'):
        sub = [r for r in res if r[1] == kind]
        print(f"# {kind}: killed {sum(r[3]=='KILLED' for r in sub)}/{len(sub)}")
