#!/usr/bin/env python3
"""Arms for the author's LATEST plan (inline replies 12:53-12:56 UTC), built from the PR head sources.
L2 = 10:52 plan (as in L1) + the reply additions, literally: replacement must preserve-or-advance the claim
     fields (an owner drop fails), lastSequence monotonic, Number allowlist, 20-arg constructor package-private.
C2 = L2 + three additions: the owner-clearing move into UNKNOWN is exempt from preserve-or-advance,
     a repository resolveUnknown(id, generation, result, time), and CANCEL_REQUESTED => cancelRequested."""
import shutil, subprocess
H = '/root/verify/pr12391-harness/trees/'
PKG = 'sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/'
TEST = 'sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/InMemoryRepositoryTest.java'

def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (path, old[:90], n)
        s = s.replace(old, new)
    open(path, 'w').write(s)

def build(arm, c2):
    shutil.rmtree(H + arm, ignore_errors=True)
    shutil.copytree(H + 'L1', H + arm, ignore=shutil.ignore_patterns('target'))   # L1 = 10:52 plan
    base = H + arm + '/'
    repo = base + PKG + 'InMemoryToolExecutionRepository.java'
    claim = """        boolean keepsOrAdvancesClaim = current.getDispatchOwner().equals(
                replacement.getDispatchOwner())
                && replacement.getDispatchGeneration()
                        >= current.getDispatchGeneration()
                && !replacement.getDispatchLeaseUntil().isBefore(
                        current.getDispatchLeaseUntil());
"""
    if c2:
        claim = claim.replace("        boolean keepsOrAdvancesClaim = current", "        boolean keepsOrAdvancesClaim = replacement.getDispatchOwner() != null\n                && current")
        claim += """        boolean releasesToUnknown = to == ToolExecutionRecord.State.UNKNOWN
                && replacement.getDispatchOwner() == null
                && replacement.getDispatchGeneration()
                        == current.getDispatchGeneration();
        if (!keepsOrAdvancesClaim && !releasesToUnknown) {
"""
    else:
        claim = claim.replace("        boolean keepsOrAdvancesClaim = current", "        boolean keepsOrAdvancesClaim = replacement.getDispatchOwner() != null\n                && current")
        claim += """        if (!keepsOrAdvancesClaim) {
"""
    claim += """            throw new IllegalArgumentException(
                    "replacement must preserve or advance the dispatch claim");
        }
        if (replacement.getLastSequence() < current.getLastSequence()) {
            throw new IllegalArgumentException(
                    "result sequence must not move backwards");
        }
    }

    private static Duration requireDuration("""
    pairs = [("""            throw new IllegalStateException(
                    "execution state must not move backwards");
        }
    }

    private static Duration requireDuration(""", """            throw new IllegalStateException(
                    "execution state must not move backwards");
        }
""" + claim)]
    if c2:
        pairs.append(("""    @Override
    public synchronized boolean hasActiveByRuntimeSession(""", """    @Override
    public synchronized ToolExecutionRecord resolveUnknown(
            String executionCallId, long dispatchGeneration,
            Map<String, Object> result, Instant resolutionTime) {
        ToolExecutionRecord current = requireRecord(executionCallId);
        if (current == null
                || current.getState() != ToolExecutionRecord.State.UNKNOWN
                || current.getDispatchGeneration() != dispatchGeneration) {
            return null;
        }
        ToolExecutionRecord resolved = current.resolveUnknown(result,
                resolutionTime).withVersion(current.getVersion() + 1);
        recordsById.put(executionCallId, resolved);
        return resolved;
    }

    @Override
    public synchronized boolean hasActiveByRuntimeSession("""))
    edit(repo, pairs)
    if c2:
        edit(base + PKG + 'ToolExecutionRepository.java', [
            ("import java.time.Duration;\n", "import java.time.Duration;\nimport java.time.Instant;\nimport java.util.Map;\n"),
            ("""    ToolExecutionRecord requestCancel(String executionCallId);
""", """    ToolExecutionRecord requestCancel(String executionCallId);

    ToolExecutionRecord resolveUnknown(String executionCallId,
            long dispatchGeneration, Map<String, Object> result,
            Instant resolutionTime);
""")])
    rec = base + PKG + 'ToolExecutionRecord.java'
    pairs = [("""    public ToolExecutionRecord(String executionCallId, String idempotencyKey,""",
              """    ToolExecutionRecord(String executionCallId, String idempotencyKey,""")]
    if c2:
        pairs.append(("""        if (state == State.SETTLED
                && (executionStatus == null""", """        if (state == State.CANCEL_REQUESTED && !cancelRequested) {
            throw new IllegalArgumentException(
                    "cancel-requested state requires cancellation intent");
        }
        if (state == State.SETTLED
                && (executionStatus == null"""))
    edit(rec, pairs)
    bv = base + PKG + 'BrokerValues.java'
    edit(bv, [("""        if (value == null || value instanceof String
                || value instanceof Number || value instanceof Boolean) {""", """        if (value == null || value instanceof String
                || value instanceof Boolean || value instanceof Integer
                || value instanceof Long || value instanceof Short
                || value instanceof Byte || value instanceof Double
                || value instanceof Float || value instanceof BigInteger
                || value instanceof BigDecimal) {"""),
              ("import java.net.URI;\n", "import java.math.BigDecimal;\nimport java.math.BigInteger;\nimport java.net.URI;\n")])

build('L2', False)
build('C2', True)
print('built L2 and C2')
