#!/usr/bin/env python3
"""Targeted mutants for the bot's R1-6 survivor claims plus its killed controls.
Each mutant = one exact-string replacement (must match exactly once) in a private copy of the module;
runs `mvn -o -q test` with host JDK 21; classifies KILLED (test failure) / SURVIVED / COMPILE_ERROR."""
import os, shutil, subprocess, sys, hashlib, concurrent.futures as cf
SRC = '/root/verify/pr12391-harness/trees/head/sdk-java'
PKG = 'runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/'
WORK = '/root/verify/pr12391-harness/mutants/work'
R = PKG + 'InMemoryToolExecutionRepository.java'
T = PKG + 'ToolExecutionRecord.java'
B = PKG + 'BrokerValues.java'
M = [
 # --- bot R1-6 claimed survivors
 ('S01', 'renewDispatch: expiry clause deleted', R,
  "\n                || !current.getDispatchLeaseUntil().isAfter(now)) {\n            return null;\n        }\n        ToolExecutionRecord renewed",
  ") {\n            return null;\n        }\n        ToolExecutionRecord renewed"),
 ('S02', 'renewDispatch: generation clause deleted', R,
  "\n                || dispatchGeneration != current.getDispatchGeneration()", ""),
 ('S03', 'findOrCreate: duplicate-executionCallId rejection deleted', R,
  "if (duplicateId != null) {", "if (false) {"),
 ('S04', 'claimDispatch: cancelRequested ternary deleted (always DISPATCHING)', R,
  "ToolExecutionRecord.State nextState = current.isCancelRequested()",
  "ToolExecutionRecord.State nextState = false && current.isCancelRequested()"),
 ('S05', 'findOrCreate: requireCandidate call deleted', R,
  "        requireCandidate(candidate);\n", ""),
 ('S06', 'requireReplacement: identity clause deleted', R,
  "                || !expected.sameIdentity(replacement)\n", ""),
 ('S07', 'compareAndSet: version advance removed (updated = replacement)', R,
  "ToolExecutionRecord updated = replacement.withVersion(\n                expected.getVersion() + 1);",
  "ToolExecutionRecord updated = replacement;"),
 ('S08', 'hasActiveByRuntimeSession: session-id term deleted', R,
  ".anyMatch(record -> id.equals(record.getRuntimeSessionId())\n                        && !record.isSettled());",
  ".anyMatch(record -> !record.isSettled());"),
 ('S09', 'claimDispatch: owner write keeps the old owner on takeover', R,
  "ToolExecutionRecord claimed = current.withDispatch(ownerId,",
  "ToolExecutionRecord claimed = current.withDispatch(current.getDispatchOwner() == null ? ownerId : current.getDispatchOwner(),"),
 ('S10', 'withResult: backwards-sequence guard deleted', T,
  "if (sequence < lastSequence) {", "if (false) {"),
 ('S11', 'withResult: stores lastSequence instead of sequence', T,
  "return copy(State.SETTLED, (String) status, nextResult, sequence,",
  "return copy(State.SETTLED, (String) status, nextResult, lastSequence,"),
 ('S12', 'sameRequest: gains the executionCallId term', T,
  "boolean sameRequest(ToolExecutionRecord other) {\n        return other != null\n",
  "boolean sameRequest(ToolExecutionRecord other) {\n        return other != null\n                && executionCallId.equals(other.executionCallId)\n"),
 ('S13', 'sameRequest: body -> return false', T,
  "boolean sameRequest(ToolExecutionRecord other) {\n        return other != null\n",
  "boolean sameRequest(ToolExecutionRecord other) {\n        return false && other != null\n"),
 ('S14', 'ctor: reference/identity cross-check deleted', T,
  "if (!runtimeSessionId.equals(reference.get(\"sessionId\"))",
  "if (false && !runtimeSessionId.equals(reference.get(\"sessionId\"))"),
 ('S15', 'ctor: settled-requires-status/result/time deleted', T,
  "if (state == State.SETTLED\n                && (executionStatus == null",
  "if (false && state == State.SETTLED\n                && (executionStatus == null"),
 ('S16', 'ctor: non-settled-must-not-carry-result deleted', T,
  "if (state != State.SETTLED\n", "if (false && state != State.SETTLED\n"),
 ('S17', 'BrokerValues: unsupported-value rejection deleted', B,
  "throw new IllegalArgumentException(\"unsupported JSON value\");", "return value;"),
 # --- the bot's (and R1's) killed controls: these MUST be killed or the harness is broken
 ('C01', 'control: compareAndSet settled check deleted', R,
  "\n                || current.isSettled()) {\n            return null;\n        }\n        ToolExecutionRecord updated",
  ") {\n            return null;\n        }\n        ToolExecutionRecord updated"),
 ('C02', 'control: compareAndSet version comparison deleted', R,
  "\n                || current.getVersion() != expected.getVersion()\n                || current.isSettled()",
  "\n                || current.isSettled()"),
 ('C03', 'control: sequence guard tightened < to <=', T,
  "if (sequence < lastSequence) {", "if (sequence <= lastSequence) {"),
 ('C04', 'control: sameRequest body -> other != null', T,
  "boolean sameRequest(ToolExecutionRecord other) {\n        return other != null\n",
  "boolean sameRequest(ToolExecutionRecord other) {\n        return other != null || true\n"),
 ('C05', 'control: create path stores candidate.withVersion(0)', R,
  "        recordsById.put(candidate.getExecutionCallId(), candidate);\n        idsByIdempotencyKey.put(candidate.getIdempotencyKey(),\n                candidate.getExecutionCallId());\n        return candidate;",
  "        ToolExecutionRecord stored = candidate.withVersion(0);\n        recordsById.put(candidate.getExecutionCallId(), stored);\n        idsByIdempotencyKey.put(candidate.getIdempotencyKey(),\n                candidate.getExecutionCallId());\n        return stored;"),
 ('C06', 'control: claimDispatch live-lease exclusion deleted', R,
  "        if (current.getDispatchOwner() != null\n                && current.getDispatchLeaseUntil().isAfter(now)) {\n            return null;\n        }\n",
  ""),
]
ENV = dict(os.environ, JAVA_HOME='/root/Install/jdk21', PATH='/root/Install/jdk21/bin:/root/Install/maven/bin:' + os.environ['PATH'])

def run(m):
    mid, desc, rel, old, new = m
    d = os.path.join(WORK, mid)
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns('target'))
    p = os.path.join(d, rel)
    s = open(p).read()
    n = s.count(old)
    if n != 1:
        return (mid, desc, f'BAD_PATTERN(count={n})', '')
    s2 = s.replace(old, new)
    assert hashlib.sha1(s2.encode()).hexdigest() != hashlib.sha1(s.encode()).hexdigest()
    open(p, 'w').write(s2)
    r = subprocess.run(['mvn', '-o', '-q', '-B', '-Djacoco.skip=true', 'test'], cwd=os.path.join(d, 'runtime-broker'),
                       env=ENV, capture_output=True, text=True)
    out = r.stdout + r.stderr
    if 'COMPILATION ERROR' in out:
        verdict = 'COMPILE_ERROR'
    elif r.returncode == 0:
        verdict = 'SURVIVED'
    elif 'Tests run:' in out and ('FAILURE' in out or 'Failures: ' in out):
        verdict = 'KILLED'
    else:
        verdict = f'INFRA(rc={r.returncode})'
    first = ''
    for line in out.splitlines():
        if line.startswith('[ERROR]   ') or 'expected:' in line or 'Exception' in line:
            first = line.strip()[:150]; break
    open(os.path.join(WORK, mid + '.log'), 'w').write(out)
    shutil.rmtree(d, ignore_errors=True)
    return (mid, desc, verdict, first)

if __name__ == '__main__':
    os.makedirs(WORK, exist_ok=True)
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(run, M))
    for r in res:
        print(f'{r[0]}  {r[2]:14s} {r[1]}' + (f'   <- {r[3]}' if r[3] and r[2] == 'KILLED' else ''))
    s = [r for r in res if r[0].startswith('S')]; c = [r for r in res if r[0].startswith('C')]
    print(f"claimed survivors: {sum(r[2]=='SURVIVED' for r in s)}/{len(s)} survived ; controls: {sum(r[2]=='KILLED' for r in c)}/{len(c)} killed")
