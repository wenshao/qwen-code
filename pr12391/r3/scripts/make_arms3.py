#!/usr/bin/env python3
"""R3 arms on top of 25a38c3.
  T  = 25a38c3 + the author's own 10:06 pinning test ("owner A re-reads for a fresh version,
       withResult must fail"), written against the 2-arg CAS exactly as it ships.
  F  = 25a38c3 + the agreed actor fence: compareAndSet(expected, replacement, owner, dispatchGeneration)
       replaces the 2-arg one; the 10:06 test uses owner A's own identity.
  F2 = F + the accepted "no backwards transitions toward PREPARED" rule (and EXECUTING/CANCEL_REQUESTED
       -> DISPATCHING)."""
import shutil, re
SRC = '/root/verify/pr12391-harness/r3/trees/head/sdk-java'
OUT = '/root/verify/pr12391-harness/r3/trees/'
PKG = 'runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/'
TEST = 'runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/InMemoryRepositoryTest.java'

def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        n = s.count(old); assert n == 1, (path, old[:80], n); s = s.replace(old, new)
    open(path, 'w').write(s)

def add_test(path, body):
    s = open(path).read()
    anchor = "    private static ToolExecutionRecord execution(String executionCallId) {"
    assert s.count(anchor) == 1
    s = s.replace(anchor, body + "\n" + anchor)
    open(path, 'w').write(s)

TEST_2ARG = '''    @Test
    void staleOwnerCannotSettleAfterReReadingAFreshVersion() {
        MutableClock clock = new MutableClock(START);
        InMemoryToolExecutionRepository repository =
                new InMemoryToolExecutionRepository(clock);
        ToolExecutionRecord created = repository.findOrCreate(
                execution("execution"));
        repository.claimDispatch(created.getExecutionCallId(), "owner-a",
                Duration.ofSeconds(30));
        clock.advance(Duration.ofSeconds(31));
        ToolExecutionRecord takeover = repository.claimDispatch(
                created.getExecutionCallId(), "owner-b",
                Duration.ofSeconds(30));

        // Owner A re-reads for a fresh version; its settlement must fail.
        ToolExecutionRecord reread = repository.findByExecutionCallId(
                created.getExecutionCallId());
        assertNull(repository.compareAndSet(reread,
                reread.withResult(result("error"), 0, clock.instant())));
        assertSame(takeover, repository.findByExecutionCallId(
                created.getExecutionCallId()));
    }
'''
TEST_4ARG = TEST_2ARG.replace(
    '''reread.withResult(result("error"), 0, clock.instant())));''',
    '''reread.withResult(result("error"), 0, clock.instant()),
                "owner-a", 1));
        // Right generation, wrong owner: still not owner B's claim.
        assertNull(repository.compareAndSet(reread,
                reread.withResult(result("error"), 0, clock.instant()),
                "owner-a", 2));
        ToolExecutionRecord settled = repository.compareAndSet(takeover,
                takeover.withResult(result("success"), 0, clock.instant()),
                "owner-b", 2);
        assertEquals("success", settled.getExecutionStatus());''').replace(
    '''        assertSame(takeover, repository.findByExecutionCallId(
                created.getExecutionCallId()));
''', '')

# The caller's own identity at each ToolExecution CAS call site, in file order (literals, never copied
# from a snapshot: copying the owner out of a re-read snapshot is exactly what the fence must defeat).
CALLERS = [('"owner-a"', 1), ('"owner-b"', 2), ('"owner-b"', 2), ('"owner-a"', 1), ('null', 0),
           ('"owner-a"', 1), ('"owner-a"', 2), ('"owner-a"', 1), ('"owner-a"', 1), ('"owner-a"', 1),
           ('"owner-a"', 1), ('"owner-a"', 1), ('"owner-a"', 1), ('"owner-b"', 2)]

TEST_STALE_GEN = """    @Test
    void sameOwnerCannotWriteWithAStaleGeneration() {
        MutableClock clock = new MutableClock(START);
        InMemoryToolExecutionRepository repository =
                new InMemoryToolExecutionRepository(clock);
        ToolExecutionRecord created = repository.findOrCreate(
                execution("execution"));
        repository.claimDispatch(created.getExecutionCallId(), "owner-a",
                Duration.ofSeconds(30));
        clock.advance(Duration.ofSeconds(31));
        ToolExecutionRecord reclaimed = repository.claimDispatch(
                created.getExecutionCallId(), "owner-a",
                Duration.ofSeconds(30));
        assertEquals(2, reclaimed.getDispatchGeneration());

        // Same owner, but the generation it claimed first: fenced off.
        assertNull(repository.compareAndSet(reclaimed,
                reclaimed.withResult(result("error"), 0, clock.instant()),
                "owner-a", 1));
        assertEquals("success", repository.compareAndSet(reclaimed,
                reclaimed.withResult(result("success"), 0, clock.instant()),
                "owner-a", 2).getExecutionStatus());
    }
"""

TEST_NO_BACKWARDS = """    @Test
    void executionStateDoesNotMoveBackwards() {
        MutableClock clock = new MutableClock(START);
        InMemoryToolExecutionRepository repository =
                new InMemoryToolExecutionRepository(clock);
        ToolExecutionRecord created = repository.findOrCreate(
                execution("execution"));
        ToolExecutionRecord claimed = repository.claimDispatch(
                created.getExecutionCallId(), "owner-a",
                Duration.ofSeconds(30));
        ToolExecutionRecord executing = repository.compareAndSet(claimed,
                claimed.withState(ToolExecutionRecord.State.EXECUTING, false),
                "owner-a", 1);

        assertThrows(IllegalArgumentException.class,
                () -> repository.compareAndSet(executing,
                        executing.withState(
                                ToolExecutionRecord.State.PREPARED, false),
                        "owner-a", 1));
        assertThrows(IllegalArgumentException.class,
                () -> repository.compareAndSet(executing,
                        executing.withState(
                                ToolExecutionRecord.State.DISPATCHING, false),
                        "owner-a", 1));
    }
"""

def actorize_test_calls(path):
    """Append the caller's own identity (a literal) to every ToolExecution CAS call."""
    s = open(path).read()
    start = s.index("void executionIdempotencyAndDispatchClaimAreDurablePrimitives")
    head, tail = s[:start], s[start:]
    out, i, n = [], 0, 0
    key = "repository.compareAndSet("
    while True:
        j = tail.find(key, i)
        if j < 0:
            out.append(tail[i:]); break
        k = j + len(key); depth = 1; args_start = k
        while depth:
            c = tail[k]
            depth += (c == '(') - (c == ')'); k += 1
        inner = tail[args_start:k - 1]
        first = inner.split(',', 1)[0].strip()
        if inner.rstrip().endswith('"owner-a", 1') or 'getDispatchOwner()' in inner:
            out.append(tail[i:k]); i = k; continue
        owner, gen = CALLERS[n]
        out.append(tail[i:k - 1] + f", {owner}, {gen})")
        i = k; n += 1
    assert n == len(CALLERS), (n, len(CALLERS))
    open(path, 'w').write(head + ''.join(out))
    return n

def build(arm):
    shutil.rmtree(OUT + arm, ignore_errors=True)
    shutil.copytree(SRC, OUT + arm + '/sdk-java', ignore=shutil.ignore_patterns('target'))
    base = OUT + arm + '/sdk-java/'
    if arm == 'T':
        add_test(base + TEST, TEST_2ARG)
        return
    edit(base + PKG + 'ToolExecutionRepository.java', [(
        '''    /** Mutates only while the caller holds the live dispatch claim. */
    ToolExecutionRecord compareAndSet(ToolExecutionRecord expected,
            ToolExecutionRecord replacement);''',
        '''    /** Mutates only while the named caller holds the live dispatch claim. */
    ToolExecutionRecord compareAndSet(ToolExecutionRecord expected,
            ToolExecutionRecord replacement, String owner,
            long dispatchGeneration);''')])
    repo = base + PKG + 'InMemoryToolExecutionRepository.java'
    pairs = [('''            ToolExecutionRecord expected,
            ToolExecutionRecord replacement) {
        requireReplacement(expected, replacement);''',
              '''            ToolExecutionRecord expected,
            ToolExecutionRecord replacement, String owner,
            long dispatchGeneration) {
        requireReplacement(expected, replacement);'''),
             ('''                || !current.hasLiveDispatchAt(clock.instant())) {
            return null;
        }''',
              '''                || !current.hasLiveDispatchAt(clock.instant())
                || !current.getDispatchOwner().equals(owner)
                || current.getDispatchGeneration() != dispatchGeneration) {
            return null;
        }''')]
    if arm == 'F2':
        pairs[1] = (pairs[1][0], pairs[1][1] + """
        ToolExecutionRecord.State to = replacement.getState();
        if (to == ToolExecutionRecord.State.PREPARED
                || to == ToolExecutionRecord.State.DISPATCHING
                        && current.getState()
                                != ToolExecutionRecord.State.DISPATCHING) {
            throw new IllegalArgumentException(
                    "execution state must not move backwards");
        }""")
    edit(repo, pairs)
    n = actorize_test_calls(base + TEST)
    add_test(base + TEST, TEST_4ARG)
    add_test(base + TEST, TEST_STALE_GEN)
    if arm == 'F2':
        add_test(base + TEST, TEST_NO_BACKWARDS)
    print(arm, 'test CAS call sites given the caller identity:', n)

for a in ('T', 'F', 'F2'):
    build(a)
print('built T, F, F2')
