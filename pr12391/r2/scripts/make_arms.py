#!/usr/bin/env python3
"""Build two candidate arms from the PR head sources.
L1 = the author's 10:52 plan, implemented literally (fenced 4-arg CAS replaces the unfenced one,
     requestCancel, EXECUTING takeover -> UNKNOWN + refuse, transition discipline, smaller notes).
C  = L1 + the clauses the plan does not mention (dedicated resolveUnknown, replacement keeps the claim,
     lastSequence monotonic, CANCEL_REQUESTED => cancelRequested, Number allowlist)."""
import sys
ROOT = '/root/verify/pr12391-harness/trees/%s/sdk-java/runtime-broker/'
PKG = 'src/main/java/com/alibaba/qwen/code/runtimebroker/'
TEST = 'src/test/java/com/alibaba/qwen/code/runtimebroker/InMemoryRepositoryTest.java'

def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (path, old[:80], n)
        s = s.replace(old, new)
    open(path, 'w').write(s)

def build(arm, complete):
    base = ROOT % arm
    # ---- interface
    iface = base + PKG + 'ToolExecutionRepository.java'
    pairs = [("import java.time.Duration;\n", "import java.time.Duration;\n" + ("import java.time.Instant;\nimport java.util.Map;\n" if complete else "")),
             ("""    ToolExecutionRecord compareAndSet(ToolExecutionRecord expected,
            ToolExecutionRecord replacement);
""", """    ToolExecutionRecord compareAndSet(ToolExecutionRecord expected,
            ToolExecutionRecord replacement, String owner,
            long dispatchGeneration);

    ToolExecutionRecord requestCancel(String executionCallId);
""" + ("""
    ToolExecutionRecord resolveUnknown(String executionCallId,
            long dispatchGeneration, Map<String, Object> result,
            Instant resolutionTime);
""" if complete else ""))]
    edit(iface, pairs)
    # ---- repository
    repo = base + PKG + 'InMemoryToolExecutionRepository.java'
    pairs = [
      ("import java.util.Map;\n", "import java.util.Map;\n" + ("import java.util.Objects;\n" if complete else "")),
      ("""    public synchronized ToolExecutionRecord compareAndSet(
            ToolExecutionRecord expected,
            ToolExecutionRecord replacement) {
        requireReplacement(expected, replacement);
        ToolExecutionRecord current = recordsById.get(
                expected.getExecutionCallId());
        if (current == null
                || !current.sameIdentity(expected)
                || current.getVersion() != expected.getVersion()
                || current.isSettled()) {
            return null;
        }
""", """    public synchronized ToolExecutionRecord compareAndSet(
            ToolExecutionRecord expected,
            ToolExecutionRecord replacement, String owner,
            long dispatchGeneration) {
        requireReplacement(expected, replacement);
        ToolExecutionRecord current = recordsById.get(
                expected.getExecutionCallId());
        if (current == null
                || !current.sameIdentity(expected)
                || current.getVersion() != expected.getVersion()
                || current.isSettled()) {
            return null;
        }
        if (owner == null || !owner.equals(current.getDispatchOwner())
                || dispatchGeneration != current.getDispatchGeneration()
                || !current.getDispatchLeaseUntil().isAfter(clock.instant())) {
            return null;
        }
        requireTransition(current, replacement);
"""),
      ("""        if (current.getDispatchOwner() != null
                && current.getDispatchLeaseUntil().isAfter(now)) {
            return null;
        }
""", """        if (current.getDispatchOwner() != null
                && current.getDispatchLeaseUntil().isAfter(now)) {
            return null;
        }
        if (current.getState() == ToolExecutionRecord.State.EXECUTING
                && !current.isCancelRequested()) {
            recordsById.put(executionCallId, current.withUnknown()
                    .withVersion(current.getVersion() + 1));
            return null;
        }
"""),
      ("""    @Override
    public synchronized boolean hasActiveByRuntimeSession(""", """    @Override
    public synchronized ToolExecutionRecord requestCancel(
            String executionCallId) {
        ToolExecutionRecord current = requireRecord(executionCallId);
        if (current == null || current.isSettled()) {
            return null;
        }
        if (current.isCancelRequested()) {
            return current;
        }
        ToolExecutionRecord.State state = current.getState();
        ToolExecutionRecord.State nextState =
                state == ToolExecutionRecord.State.DISPATCHING
                        || state == ToolExecutionRecord.State.EXECUTING
                ? ToolExecutionRecord.State.CANCEL_REQUESTED : state;
        ToolExecutionRecord cancelled = current.withState(nextState, true)
                .withVersion(current.getVersion() + 1);
        recordsById.put(executionCallId, cancelled);
        return cancelled;
    }
""" + ("""
    @Override
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
""" if complete else "") + """
    @Override
    public synchronized boolean hasActiveByRuntimeSession("""),
      ("""        if (candidate == null || candidate.getVersion() != 0
""", """        if (candidate == null || candidate.getVersion() != 0
                || candidate.getLastSequence() != 0
"""),
      ("""    private static Duration requireDuration(""", """    private static void requireTransition(ToolExecutionRecord current,
            ToolExecutionRecord replacement) {
        ToolExecutionRecord.State from = current.getState();
        ToolExecutionRecord.State to = replacement.getState();
        if (from == ToolExecutionRecord.State.UNKNOWN
                && to != ToolExecutionRecord.State.SETTLED) {
            throw new IllegalStateException(
                    "unknown execution must be resolved");
        }
        if (current.isCancelRequested() && !replacement.isCancelRequested()) {
            throw new IllegalArgumentException(
                    "cancellation intent must be preserved");
        }
        if (to == ToolExecutionRecord.State.PREPARED
                && from != ToolExecutionRecord.State.PREPARED
                || to == ToolExecutionRecord.State.DISPATCHING
                        && from == ToolExecutionRecord.State.EXECUTING) {
            throw new IllegalStateException(
                    "execution state must not move backwards");
        }
""" + ("""        boolean keepsClaim = Objects.equals(current.getDispatchOwner(),
                replacement.getDispatchOwner())
                && Objects.equals(current.getDispatchLeaseUntil(),
                        replacement.getDispatchLeaseUntil())
                && current.getDispatchGeneration()
                        == replacement.getDispatchGeneration();
        boolean releasesToUnknown = to == ToolExecutionRecord.State.UNKNOWN
                && replacement.getDispatchOwner() == null
                && current.getDispatchGeneration()
                        == replacement.getDispatchGeneration();
        if (!keepsClaim && !releasesToUnknown) {
            throw new IllegalArgumentException(
                    "replacement must preserve the dispatch claim");
        }
        if (replacement.getLastSequence() < current.getLastSequence()) {
            throw new IllegalArgumentException(
                    "result sequence must not move backwards");
        }
""" if complete else "") + """    }

    private static Duration requireDuration("""),
    ]
    edit(repo, pairs)
    # ---- record
    rec = base + PKG + 'ToolExecutionRecord.java'
    pairs = [("    boolean sameRequest(ToolExecutionRecord other) {", "    public boolean sameRequest(ToolExecutionRecord other) {")]
    if complete:
        pairs.append(("""        if (state == State.SETTLED
                && (executionStatus == null""", """        if (state == State.CANCEL_REQUESTED && !cancelRequested) {
            throw new IllegalArgumentException(
                    "cancel-requested state requires cancellation intent");
        }
        if (state == State.SETTLED
                && (executionStatus == null"""))
    edit(rec, pairs)
    # ---- BrokerValues: non-String nested key -> IAE (plan); Number allowlist (C)
    bv = base + PKG + 'BrokerValues.java'
    pairs = [("""    static Map<String, Object> immutableMap(Map<String, ?> source) {
        Map<String, Object> copy = new LinkedHashMap<>();
        for (Map.Entry<String, ?> entry : source.entrySet()) {
            if (entry.getKey() == null) {
                throw new IllegalArgumentException("map key must not be null");
            }
            copy.put(entry.getKey(), immutableValue(entry.getValue()));
        }""", """    static Map<String, Object> immutableMap(Map<?, ?> source) {
        Map<String, Object> copy = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : source.entrySet()) {
            if (!(entry.getKey() instanceof String key)) {
                throw new IllegalArgumentException("map key must be a string");
            }
            copy.put(key, immutableValue(entry.getValue()));
        }"""),
             ("""        if (value instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, ?> nested = (Map<String, ?>) value;
            return immutableMap(nested);
        }""", """        if (value instanceof Map<?, ?> nested) {
            return immutableMap(nested);
        }""")]
    if complete:
        pairs.append(("""        if (value == null || value instanceof String
                || value instanceof Number || value instanceof Boolean) {""", """        if (value == null || value instanceof String
                || value instanceof Boolean || value instanceof Integer
                || value instanceof Long || value instanceof Short
                || value instanceof Byte || value instanceof Double
                || value instanceof Float || value instanceof BigInteger
                || value instanceof BigDecimal) {"""))
        pairs.append(("import java.net.URI;\n", "import java.math.BigDecimal;\nimport java.math.BigInteger;\nimport java.net.URI;\n"))
    edit(bv, pairs)
    # ---- PR test: the 2-arg CAS no longer exists; pass each caller's own claim token (3 call sites)
    t = base + TEST
    edit(t, [
      ("""        assertNull(repository.compareAndSet(first,
                first.withResult(result("error"), 0, clock.instant())));""",
       """        assertNull(repository.compareAndSet(first,
                first.withResult(result("error"), 0, clock.instant()),
                "owner-a", 1));"""),
      ("""        ToolExecutionRecord settled = repository.compareAndSet(takeover,
                takeover.withResult(result("success"), 0,
                        clock.instant()));""",
       """        ToolExecutionRecord settled = repository.compareAndSet(takeover,
                takeover.withResult(result("success"), 0,
                        clock.instant()), "owner-b", 2);"""),
      ("""        assertNull(repository.compareAndSet(settled,
                settled.withState(ToolExecutionRecord.State.PREPARED,
                        false)));""",
       """        assertNull(repository.compareAndSet(settled,
                settled.withState(ToolExecutionRecord.State.PREPARED,
                        false), "owner-b", 2));"""),
    ])

build('L1', False)
build('C', True)
print('arms built')
