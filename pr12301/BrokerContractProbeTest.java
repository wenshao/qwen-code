package com.alibaba.qwen.code.runtimebroker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Independent adversarial probe of the PR 12301 state contract.
 * Written by the reviewer; not part of the PR.
 */
class BrokerContractProbeTest {
    private static final Instant START = Instant.parse("2026-09-18T00:00:00Z");
    private static final RuntimeScope SCOPE = new RuntimeScope("tenant", "workspace",
            "generation", "/workspace", "capability", "session");
    private static final RuntimeProvisionRequest REQUEST =
            new RuntimeProvisionRequest(SCOPE, "harness");
    private static final RuntimeLease LEASE = new RuntimeLease("runtime",
            URI.create("http://127.0.0.1:4096"), "token", "lease", 1);

    // ---------- P1: one active generation under maximal contention ----------
    @Test
    @DisplayName("P1 32-thread barrier-synchronised findOrCreate, 50 rounds")
    void p1OneGenerationUnderContention() throws Exception {
        for (int round = 0; round < 50; round++) {
            AtomicInteger ids = new AtomicInteger();
            InMemoryRuntimeBindingRepository repo = new InMemoryRuntimeBindingRepository(
                    Clock.systemUTC(), () -> "b-" + ids.incrementAndGet());
            Set<String> seen = new HashSet<>(runConcurrently(32,
                    () -> repo.findOrCreate(REQUEST).getBindingId()));
            assertEquals(Set.of("b-1"), seen, "round " + round);
            assertEquals(1, ids.get(), "id supplier calls, round " + round);
            assertEquals(1L, repo.findActive(REQUEST).getGeneration());
        }
    }

    // ---------- P2: exactly one CAS winner per version ----------
    @Test
    @DisplayName("P2 16 racing compareAndSet calls per version, 100 rounds")
    void p2ExactlyOneCasWinnerPerVersion() throws Exception {
        InMemoryRuntimeBindingRepository repo = new InMemoryRuntimeBindingRepository(
                Clock.systemUTC(), () -> "binding");
        RuntimeBindingRecord current = repo.claimOperation(
                repo.findOrCreate(REQUEST).getBindingId(), "owner", Duration.ofHours(1));
        long baseVersion = current.getVersion();
        for (int round = 0; round < 100; round++) {
            RuntimeBindingRecord expected = current;
            boolean flag = round % 2 == 0;
            List<RuntimeBindingRecord> results = runConcurrently(16,
                    () -> repo.compareAndSet(expected,
                            expected.withDrainRequested(flag, START)));
            List<RuntimeBindingRecord> winners = new ArrayList<>();
            for (RuntimeBindingRecord r : results) {
                if (r != null) {
                    winners.add(r);
                }
            }
            assertEquals(1, winners.size(), "winners in round " + round);
            current = winners.get(0);
            assertEquals(expected.getVersion() + 1, current.getVersion());
        }
        assertEquals(baseVersion + 100, current.getVersion());
    }

    // ---------- P3: wall-clock lease expiry really fences ----------
    @Test
    @DisplayName("P3 real system clock: expired claim cannot write, takeover succeeds")
    void p3WallClockLeaseFencing() throws Exception {
        InMemoryRuntimeBindingRepository repo = new InMemoryRuntimeBindingRepository();
        RuntimeBindingRecord binding = repo.findOrCreate(REQUEST);
        RuntimeBindingRecord claimed = repo.claimOperation(binding.getBindingId(),
                "owner-a", Duration.ofMillis(150));
        assertNotNull(claimed);
        assertNotNull(repo.compareAndSet(claimed,
                claimed.withState(RuntimeBindingRecord.State.READY, LEASE, Instant.now())));
        TimeUnit.MILLISECONDS.sleep(400);
        RuntimeBindingRecord afterExpiry = repo.findById(binding.getBindingId());
        assertNull(repo.compareAndSet(afterExpiry,
                afterExpiry.withDrainRequested(true, Instant.now())),
                "expired owner must not write");
        assertNull(repo.renewOperation(binding.getBindingId(), "owner-a",
                afterExpiry.getOperationGeneration(), Duration.ofSeconds(5)),
                "expired lease must not be renewable");
        RuntimeBindingRecord takeover = repo.claimOperation(binding.getBindingId(),
                "owner-b", Duration.ofSeconds(5));
        assertNotNull(takeover);
        assertEquals("owner-b", takeover.getOperationOwner());
        assertEquals(afterExpiry.getOperationGeneration() + 1,
                takeover.getOperationGeneration());
    }

    // ---------- P4: expiry boundary is exact ----------
    @Test
    @DisplayName("P4 lease boundary: live at T-1ns, dead at exactly T")
    void p4LeaseBoundaryIsExclusive() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repo =
                new InMemoryRuntimeBindingRepository(clock, () -> "binding");
        RuntimeBindingRecord binding = repo.findOrCreate(REQUEST);
        RuntimeBindingRecord claimed = repo.claimOperation(binding.getBindingId(),
                "owner", Duration.ofSeconds(30));
        clock.advance(Duration.ofSeconds(30).minusNanos(1));
        RuntimeBindingRecord written = repo.compareAndSet(claimed,
                claimed.withDrainRequested(true, clock.instant()));
        assertNotNull(written, "write one nanosecond before expiry must succeed");
        clock.advance(Duration.ofNanos(1));
        assertNull(repo.compareAndSet(written,
                written.withDrainRequested(false, clock.instant())),
                "write at exactly leaseUntil must be fenced");
    }

    // ---------- P5: terminal records cannot be reactivated, any path ----------
    @Test
    @DisplayName("P5 terminal x target matrix for bindings and Sessions")
    void p5TerminalRecordsStayTerminal() {
        for (RuntimeBindingRecord.State terminal : new RuntimeBindingRecord.State[] {
                RuntimeBindingRecord.State.FAILED, RuntimeBindingRecord.State.RELEASED }) {
            for (RuntimeBindingRecord.State target : new RuntimeBindingRecord.State[] {
                    RuntimeBindingRecord.State.PROVISIONING,
                    RuntimeBindingRecord.State.READY,
                    RuntimeBindingRecord.State.DRAINING }) {
                MutableClock clock = new MutableClock(START);
                InMemoryRuntimeBindingRepository repo =
                        new InMemoryRuntimeBindingRepository(clock, () -> "binding");
                RuntimeBindingRecord claimed = repo.claimOperation(
                        repo.findOrCreate(REQUEST).getBindingId(), "owner",
                        Duration.ofHours(1));
                RuntimeBindingRecord dead = repo.compareAndSet(claimed,
                        claimed.withState(terminal, LEASE, START));
                assertFalse(dead.isActive());
                RuntimeBindingRecord revive = dead.withState(target, LEASE, START);
                assertThrows(IllegalArgumentException.class,
                        () -> repo.compareAndSet(dead, revive),
                        terminal + " -> " + target);
                assertNull(repo.claimOperation("binding", "owner-b",
                        Duration.ofHours(1)), "claim on " + terminal);
                assertNull(repo.renewOperation("binding", "owner",
                        dead.getOperationGeneration(), Duration.ofHours(1)),
                        "renew on " + terminal);
                assertEquals(terminal, repo.findById("binding").getState());
            }
        }
        for (RuntimeSessionRecord.State terminal : new RuntimeSessionRecord.State[] {
                RuntimeSessionRecord.State.FAILED, RuntimeSessionRecord.State.RELEASED }) {
            for (RuntimeSessionRecord.State target : new RuntimeSessionRecord.State[] {
                    RuntimeSessionRecord.State.ACQUIRING,
                    RuntimeSessionRecord.State.READY,
                    RuntimeSessionRecord.State.RELEASING }) {
                InMemoryRuntimeSessionRepository repo = new InMemoryRuntimeSessionRepository();
                RuntimeSessionRecord created = repo.findOrCreate(new RuntimeSessionRecord(
                        new RuntimeSession("harness", "session", "bootstrap", SCOPE),
                        "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START));
                RuntimeSessionRecord dead = repo.compareAndSet(created,
                        created.withState(terminal, START));
                RuntimeSessionRecord revive = dead.withState(target, START);
                assertThrows(IllegalArgumentException.class,
                        () -> repo.compareAndSet(dead, revive),
                        terminal + " -> " + target);
                assertEquals(terminal, repo.findById(SCOPE, "session").getState());
            }
        }
    }

    // ---------- P6: Session identity is scoped by every scope field ----------
    @Test
    @DisplayName("P6 same runtimeSessionId isolated across all six scope fields")
    void p6SessionIdentityIsScoped() {
        InMemoryRuntimeSessionRepository repo = new InMemoryRuntimeSessionRepository();
        List<RuntimeScope> scopes = List.of(
                SCOPE,
                new RuntimeScope("other", "workspace", "generation", "/workspace",
                        "capability", "session"),
                new RuntimeScope("tenant", "other", "generation", "/workspace",
                        "capability", "session"),
                new RuntimeScope("tenant", "workspace", "other", "/workspace",
                        "capability", "session"),
                new RuntimeScope("tenant", "workspace", "generation", "/other",
                        "capability", "session"),
                new RuntimeScope("tenant", "workspace", "generation", "/workspace",
                        "other", "session"),
                new RuntimeScope("tenant", "workspace", "generation", "/workspace",
                        "capability", "workspace"));
        List<RuntimeSessionRecord> created = new ArrayList<>();
        for (RuntimeScope scope : scopes) {
            created.add(repo.findOrCreate(new RuntimeSessionRecord(
                    new RuntimeSession("harness", "session", "bootstrap", scope),
                    "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START)));
        }
        for (int i = 0; i < scopes.size(); i++) {
            assertSame(created.get(i), repo.findById(scopes.get(i), "session"),
                    "scope variant " + i);
            for (int j = 0; j < scopes.size(); j++) {
                if (i != j) {
                    assertNotSame(created.get(i), repo.findById(scopes.get(j), "session"));
                }
            }
        }
        assertEquals(scopes.size(), repo.countActiveByBinding("binding", 1));
        assertEquals(0, repo.countActiveByBinding("binding", 2));
    }

    // ---------- P7: same-scope identity collisions fail closed, per field ----------
    @Test
    @DisplayName("P7 every immutable Session field collides closed and preserves state")
    void p7SameScopeCollisionsFailClosed() {
        InMemoryRuntimeSessionRepository repo = new InMemoryRuntimeSessionRepository();
        RuntimeSessionRecord original = repo.findOrCreate(new RuntimeSessionRecord(
                new RuntimeSession("harness", "session", "bootstrap", SCOPE),
                "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START));
        List<RuntimeSessionRecord> collisions = List.of(
                new RuntimeSessionRecord(
                        new RuntimeSession("other-harness", "session", "bootstrap", SCOPE),
                        "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START),
                new RuntimeSessionRecord(
                        new RuntimeSession("harness", "session", "continuation", SCOPE),
                        "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START),
                new RuntimeSessionRecord(
                        new RuntimeSession("harness", "session", "bootstrap", SCOPE),
                        "other-binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START),
                new RuntimeSessionRecord(
                        new RuntimeSession("harness", "session", "bootstrap", SCOPE),
                        "binding", 2, RuntimeSessionRecord.State.ACQUIRING, 0, START));
        for (RuntimeSessionRecord collision : collisions) {
            assertThrows(IllegalArgumentException.class,
                    () -> repo.findOrCreate(collision));
            assertSame(original, repo.findById(SCOPE, "session"));
        }
        assertEquals(1, repo.countActiveByBinding("binding", 1));
    }

    // ---------- P8: renewal invalidates the owner's in-flight write ----------
    @Test
    @DisplayName("P8 renewOperation bumps version and lease, fencing the owner's own CAS")
    void p8RenewalFencesOwnerInFlightWrite() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repo =
                new InMemoryRuntimeBindingRepository(clock, () -> "binding");
        RuntimeBindingRecord claimed = repo.claimOperation(
                repo.findOrCreate(REQUEST).getBindingId(), "owner", Duration.ofSeconds(30));
        clock.advance(Duration.ofSeconds(10));
        RuntimeBindingRecord renewed = repo.renewOperation("binding", "owner",
                claimed.getOperationGeneration(), Duration.ofSeconds(30));
        assertNotNull(renewed, "same-owner renew inside the lease must succeed");
        assertEquals(claimed.getOperationGeneration(), renewed.getOperationGeneration());
        assertEquals(claimed.getVersion() + 1, renewed.getVersion());
        assertTrue(renewed.getOperationLeaseUntil()
                .isAfter(claimed.getOperationLeaseUntil()));
        assertNull(repo.compareAndSet(claimed,
                claimed.withState(RuntimeBindingRecord.State.READY, LEASE, clock.instant())),
                "the owner's pre-renew snapshot is fenced by its own heartbeat");
        assertNotNull(repo.compareAndSet(renewed,
                renewed.withState(RuntimeBindingRecord.State.READY, LEASE, clock.instant())));
    }

    // ---------- P9: a claim cannot be released before it expires ----------
    @Test
    @DisplayName("P9 no API releases an operation claim early")
    void p9ClaimCannotBeReleasedEarly() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repo =
                new InMemoryRuntimeBindingRepository(clock, () -> "binding");
        RuntimeBindingRecord claimed = repo.claimOperation(
                repo.findOrCreate(REQUEST).getBindingId(), "owner-a", Duration.ofMinutes(10));
        assertSame(claimed, repo.claimOperation("binding", "owner-a", Duration.ofMinutes(10)),
                "same-owner re-claim is idempotent and does not bump the version");
        assertNull(repo.claimOperation("binding", "owner-b", Duration.ofMinutes(10)));
        RuntimeBindingRecord unclaimed = new RuntimeBindingRecord(
                claimed.getBindingId(), claimed.getRequest(), claimed.getGeneration(),
                claimed.getState(), claimed.getLease(), claimed.isDrainRequested(),
                null, null, claimed.getOperationGeneration(), claimed.getVersion(),
                claimed.getLastHealthAt(), claimed.getLastActiveAt());
        assertThrows(IllegalArgumentException.class,
                () -> repo.compareAndSet(claimed, unclaimed),
                "clearing the owner through compareAndSet is rejected");
        clock.advance(Duration.ofMinutes(10));
        assertNotNull(repo.claimOperation("binding", "owner-b", Duration.ofMinutes(10)),
                "only lease expiry frees the claim");
    }

    // ---------- P10: endpoint origin validation ----------
    @Test
    @DisplayName("P10 RuntimeLease endpoint accepts origins only and normalises them")
    void p10EndpointOriginValidation() {
        assertEquals("https://host:8443/", new RuntimeLease("r",
                URI.create("https://host:8443"), "t", "l", 0).getEndpoint().toString());
        assertEquals("http://host/", new RuntimeLease("r",
                URI.create("http://host/"), "t", "l", 0).getEndpoint().toString());
        List<String> rejected = List.of("ftp://host", "http://user@host",
                "http://host/path", "http://host?q=1", "http://host#f",
                "file:///tmp", "mailto:a@b.c", "//host", "/relative");
        for (String candidate : rejected) {
            assertThrows(IllegalArgumentException.class,
                    () -> new RuntimeLease("r", URI.create(candidate), "t", "l", 0),
                    candidate);
        }
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeLease("r", null, "t", "l", 0));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeLease("r", URI.create("http://host"), "t", "l", -1));
    }

    // ---------- P11: identifier validation bounds ----------
    @Test
    @DisplayName("P11 identifier bounds: empty, NUL, 512/513 chars")
    void p11IdentifierBounds() {
        String max = repeat("a", 512);
        String tooLong = repeat("a", 513);
        assertNotNull(new RuntimeScope(max, "w", "g", "/c", "d", "session"));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeScope(tooLong, "w", "g", "/c", "d", "session"));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeScope("", "w", "g", "/c", "d", "session"));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeScope(null, "w", "g", "/c", "d", "session"));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeScope("a\u0000b", "w", "g", "/c", "d", "session"));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeScope("t", "w", "g", "/c", "d", "SESSION"));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeSession("h", "s", "Bootstrap", SCOPE));
        assertNotNull(new RuntimeScope(" ", "w", "g", "/c", "d", "session"),
                "whitespace-only identifiers are accepted");
    }

    // ---------- P12: workspace isolation class ----------
    @Test
    @DisplayName("P12 workspace isolation rejects a key and cannot be enumerated")
    void p12WorkspaceIsolationBranch() {
        RuntimeScope workspaceScope = new RuntimeScope("tenant", "workspace",
                "generation", "/workspace", "capability", "workspace");
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeProvisionRequest(workspaceScope, "key"));
        RuntimeProvisionRequest request = new RuntimeProvisionRequest(workspaceScope, null);
        assertNull(request.getIsolationKey());
        InMemoryRuntimeBindingRepository repo = new InMemoryRuntimeBindingRepository(
                new MutableClock(START), () -> "binding");
        RuntimeBindingRecord created = repo.findOrCreate(request);
        assertSame(created, repo.findActive(request));
        assertThrows(IllegalArgumentException.class,
                () -> repo.findActiveByIsolationKey(workspaceScope, null),
                "workspace-isolated bindings cannot be listed by isolation key");
        assertEquals(List.of(), repo.findActiveByIsolationKey(workspaceScope, "key"));
    }

    // ---------- P13: terminal bindings and their generations are retained ----------
    @Test
    @DisplayName("P13 released generations are never evicted; no purge API exists")
    void p13ReleasedRecordsAreRetained() {
        MutableClock clock = new MutableClock(START);
        AtomicInteger ids = new AtomicInteger();
        InMemoryRuntimeBindingRepository repo = new InMemoryRuntimeBindingRepository(
                clock, () -> "binding-" + ids.incrementAndGet());
        for (int i = 0; i < 2000; i++) {
            RuntimeBindingRecord claimed = repo.claimOperation(
                    repo.findOrCreate(REQUEST).getBindingId(), "owner", Duration.ofHours(1));
            repo.compareAndSet(claimed,
                    claimed.withState(RuntimeBindingRecord.State.RELEASED, LEASE, START));
        }
        assertEquals(2001, repo.findOrCreate(REQUEST).getGeneration());
        assertNotNull(repo.findById("binding-1"), "generation 1 is still retained");
        assertEquals(RuntimeBindingRecord.State.RELEASED,
                repo.findById("binding-1").getState());
    }

    // ---------- P14: concurrent Session findOrCreate ----------
    @Test
    @DisplayName("P14 32-thread Session findOrCreate: one winner, collisions all throw")
    void p14ConcurrentSessionCreate() throws Exception {
        for (int round = 0; round < 20; round++) {
            InMemoryRuntimeSessionRepository repo = new InMemoryRuntimeSessionRepository();
            List<RuntimeSessionRecord> results = runConcurrently(32, () ->
                    repo.findOrCreate(new RuntimeSessionRecord(
                            new RuntimeSession("harness", "session", "bootstrap", SCOPE),
                            "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START)));
            RuntimeSessionRecord first = results.get(0);
            for (RuntimeSessionRecord r : results) {
                assertSame(first, r, "round " + round);
            }
            assertEquals(1, repo.countActiveByBinding("binding", 1));
        }
    }

    // ---------- P15: Session compareAndSet needs no operation claim ----------
    @Test
    @DisplayName("P15 Session writes are version-fenced only, by design")
    void p15SessionWritesNeedNoClaim() {
        InMemoryRuntimeSessionRepository repo = new InMemoryRuntimeSessionRepository();
        RuntimeSessionRecord created = repo.findOrCreate(new RuntimeSessionRecord(
                new RuntimeSession("harness", "session", "bootstrap", SCOPE),
                "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START));
        RuntimeSessionRecord ready = repo.compareAndSet(created,
                created.withState(RuntimeSessionRecord.State.READY, START));
        assertEquals(1, ready.getVersion());
        assertNull(repo.compareAndSet(created,
                created.withState(RuntimeSessionRecord.State.RELEASING, START)),
                "stale version is rejected");
        assertTrue(ready.isAcquirable());
        assertFalse(ready.withState(RuntimeSessionRecord.State.RELEASING, START)
                .isAcquirable());
    }

    // ---------- P16: a replacement may not carry another tenant's scope ----------
    @Test
    @DisplayName("P16 compareAndSet rejects a replacement from a different Runtime scope")
    void p16ReplacementCannotCarryAnotherScope() {
        RuntimeScope tenantB = new RuntimeScope("tenant-b", "workspace", "generation",
                "/workspace", "capability", "session");
        InMemoryRuntimeSessionRepository repo = new InMemoryRuntimeSessionRepository();
        RuntimeSessionRecord held = repo.findOrCreate(new RuntimeSessionRecord(
                new RuntimeSession("harness", "session", "bootstrap", SCOPE),
                "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START));
        RuntimeSessionRecord swapped = new RuntimeSessionRecord(
                new RuntimeSession("harness", "session", "bootstrap", tenantB),
                "binding", 1, RuntimeSessionRecord.State.READY, 0, START);
        assertThrows(IllegalArgumentException.class,
                () -> repo.compareAndSet(held, swapped),
                "a replacement from another tenant scope must be rejected");
        assertEquals(SCOPE, repo.findById(SCOPE, "session").getSession().getScope());
        assertEquals(RuntimeSessionRecord.State.ACQUIRING,
                repo.findById(SCOPE, "session").getState());
        assertNull(repo.findById(tenantB, "session"));
    }

    // ---------- P17: lease durations must be positive ----------
    @Test
    @DisplayName("P17 claim and renew reject null, zero and negative lease durations")
    void p17LeaseDurationValidation() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repo =
                new InMemoryRuntimeBindingRepository(clock, () -> "binding");
        String id = repo.findOrCreate(REQUEST).getBindingId();
        for (Duration bad : new Duration[] {null, Duration.ZERO, Duration.ofSeconds(-1)}) {
            assertThrows(IllegalArgumentException.class,
                    () -> repo.claimOperation(id, "owner", bad), String.valueOf(bad));
        }
        RuntimeBindingRecord claimed = repo.claimOperation(id, "owner", Duration.ofMinutes(1));
        for (Duration bad : new Duration[] {null, Duration.ZERO, Duration.ofSeconds(-1)}) {
            assertThrows(IllegalArgumentException.class,
                    () -> repo.renewOperation(id, "owner",
                            claimed.getOperationGeneration(), bad), String.valueOf(bad));
        }
    }

    // ---------- P18: an owner without a lease is not constructible ----------
    @Test
    @DisplayName("P18 operation owner and lease expiry must be set together")
    void p18OwnerAndLeaseAreSetTogether() {
        RuntimeBindingRecord base = new RuntimeBindingRecord("binding", REQUEST, 1,
                RuntimeBindingRecord.State.PROVISIONING, null, false, null, null, 0, 0,
                null, START);
        assertThrows(IllegalArgumentException.class, () -> new RuntimeBindingRecord(
                "binding", REQUEST, 1, RuntimeBindingRecord.State.PROVISIONING, null,
                false, "owner", null, 1, 0, null, START),
                "owner without a lease expiry");
        assertThrows(IllegalArgumentException.class, () -> new RuntimeBindingRecord(
                "binding", REQUEST, 1, RuntimeBindingRecord.State.PROVISIONING, null,
                false, null, START.plusSeconds(60), 0, 0, null, START),
                "lease expiry without an owner");
        assertThrows(IllegalArgumentException.class, () -> new RuntimeBindingRecord(
                "binding", REQUEST, 1, RuntimeBindingRecord.State.PROVISIONING, null,
                false, "owner", START.plusSeconds(60), 0, 0, null, START),
                "claimed operation generation must be positive");
        assertFalse(base.hasLiveOperationAt(START));
    }

    private static String repeat(String unit, int times) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < times; index++) {
            builder.append(unit);
        }
        return builder.toString();
    }

    private static <T> List<T> runConcurrently(int threads, Callable<T> operation)
            throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        try {
            CyclicBarrier barrier = new CyclicBarrier(threads);
            List<Future<T>> futures = new ArrayList<>();
            for (int index = 0; index < threads; index++) {
                futures.add(executor.submit(() -> {
                    barrier.await(10, TimeUnit.SECONDS);
                    return operation.call();
                }));
            }
            List<T> results = new ArrayList<>();
            for (Future<T> future : futures) {
                results.add(future.get(30, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            executor.shutdownNow();
        }
    }

    private static final class MutableClock extends Clock {
        private Instant current;

        MutableClock(Instant current) {
            this.current = current;
        }

        synchronized void advance(Duration duration) {
            current = current.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public synchronized Instant instant() {
            return current;
        }
    }
}
