package com.alibaba.qwen.code.runtimebroker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** One probe per mutant that survives the PR's own suite at head 912b9771. */
class SurvivorProbeTest {
    private static final Instant START = Instant.parse("2026-09-18T00:00:00Z");
    private static final RuntimeScope SCOPE = new RuntimeScope("tenant",
            "workspace", "generation", "/workspace", "capability", "session");
    private static final RuntimeProvisionRequest REQUEST =
            new RuntimeProvisionRequest(SCOPE, "harness");
    private static final Duration LEASE = Duration.ofSeconds(30);

    private static InMemoryRuntimeBindingRepository repo(MutableClock clock) {
        return new InMemoryRuntimeBindingRepository(clock, () -> "binding");
    }

    /** M2: re-claiming under a live lease must be idempotent. */
    @Test
    void m2ClaimIsIdempotentForTheCurrentOwner() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        String id = repository.findOrCreate(REQUEST).getBindingId();
        RuntimeBindingRecord first = repository.claimOperation(id, "owner", LEASE);
        clock.advance(Duration.ofSeconds(5));
        RuntimeBindingRecord second = repository.claimOperation(id, "owner", LEASE);
        assertSame(first, second);
        assertEquals(first.getOperationGeneration(), second.getOperationGeneration());
        assertEquals(first.getVersion(), second.getVersion());
    }

    /** M3: a lease that has exactly expired is claimable by a new owner. */
    @Test
    void m3LeaseIsClaimableAtTheExactExpiryInstant() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        String id = repository.findOrCreate(REQUEST).getBindingId();
        repository.claimOperation(id, "owner", LEASE);
        clock.advance(LEASE);
        RuntimeBindingRecord taken = repository.claimOperation(id, "next", LEASE);
        assertNotNull(taken, "expired lease must be claimable at the boundary");
        assertEquals("next", taken.getOperationOwner());
    }

    /** M4: a non-owner must not be able to renew. */
    @Test
    void m4RenewRejectsForeignOwner() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        String id = repository.findOrCreate(REQUEST).getBindingId();
        RuntimeBindingRecord claimed = repository.claimOperation(id, "owner", LEASE);
        assertNull(repository.renewOperation(id, "intruder",
                claimed.getOperationGeneration(), LEASE));
        assertSame(claimed, repository.findById(id));
    }

    /** M5: a stale fencing token must not be able to renew. */
    @Test
    void m5RenewRejectsStaleOperationGeneration() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        String id = repository.findOrCreate(REQUEST).getBindingId();
        RuntimeBindingRecord claimed = repository.claimOperation(id, "owner", LEASE);
        assertNull(repository.renewOperation(id, "owner",
                claimed.getOperationGeneration() - 1, LEASE));
        assertSame(claimed, repository.findById(id));
    }

    /** M6: an expired lease must not be renewable, even by its owner. */
    @Test
    void m6RenewRejectsExpiredLease() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        String id = repository.findOrCreate(REQUEST).getBindingId();
        RuntimeBindingRecord claimed = repository.claimOperation(id, "owner", LEASE);
        clock.advance(LEASE.plusSeconds(1));
        assertNull(repository.renewOperation(id, "owner",
                claimed.getOperationGeneration(), LEASE));
    }

    /** M8: an empty identifier is rejected. */
    @Test
    void m8RejectsEmptyIdentifier() {
        InMemoryRuntimeBindingRepository repository = repo(new MutableClock(START));
        assertThrows(IllegalArgumentException.class, () -> repository.findById(""));
    }

    /** M9: an over-long identifier is rejected. */
    @Test
    void m9RejectsOverlongIdentifier() {
        InMemoryRuntimeBindingRepository repository = repo(new MutableClock(START));
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < 513; index++) {
            builder.append('x');
        }
        String overlong = builder.toString();
        assertThrows(IllegalArgumentException.class,
                () -> repository.findById(overlong));
    }

    /** M10: an identifier carrying a NUL byte is rejected. */
    @Test
    void m10RejectsNulByteIdentifier() {
        InMemoryRuntimeBindingRepository repository = repo(new MutableClock(START));
        assertThrows(IllegalArgumentException.class,
                () -> repository.findById("bind\u0000ing"));
    }

    /** M11: CAS must reject an expectation that forges the binding identity. */
    @Test
    void m11CasRejectsForgedIdentity() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        String id = repository.findOrCreate(REQUEST).getBindingId();
        RuntimeBindingRecord claimed = repository.claimOperation(id, "owner", LEASE);
        RuntimeBindingRecord forged = new RuntimeBindingRecord(id, REQUEST,
                claimed.getGeneration() + 1, claimed.getState(), claimed.getLease(),
                claimed.isDrainRequested(), claimed.getOperationOwner(),
                claimed.getOperationLeaseUntil(), claimed.getOperationGeneration(),
                claimed.getVersion(), claimed.getLastHealthAt(),
                claimed.getLastActiveAt());
        assertNull(repository.compareAndSet(forged,
                forged.withDrainRequested(true, START)));
        assertSame(claimed, repository.findById(id));
    }

    /** M12: CAS must reject an expectation that rewrites the operation claim. */
    @Test
    void m12CasRejectsRewrittenOperationClaim() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        String id = repository.findOrCreate(REQUEST).getBindingId();
        RuntimeBindingRecord claimed = repository.claimOperation(id, "owner", LEASE);
        RuntimeBindingRecord hijack = claimed.withOperation("intruder",
                claimed.getOperationLeaseUntil(), claimed.getOperationGeneration());
        assertNull(repository.compareAndSet(hijack,
                hijack.withDrainRequested(true, START)));
        assertSame(claimed, repository.findById(id));
        assertEquals("owner", repository.findById(id).getOperationOwner());
    }

    /** M16: a replacement at a different version is a programming error. */
    @Test
    void m16ReplacementMustCarryTheExpectedVersion() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        String id = repository.findOrCreate(REQUEST).getBindingId();
        RuntimeBindingRecord claimed = repository.claimOperation(id, "owner", LEASE);
        RuntimeBindingRecord bumped = claimed
                .withDrainRequested(true, START)
                .withVersion(claimed.getVersion() + 1);
        assertThrows(IllegalArgumentException.class,
                () -> repository.compareAndSet(claimed, bumped));
    }

    /** M20: Session counting is scoped to one runtime generation. */
    @Test
    void m20CountIsScopedToOneRuntimeGeneration() {
        InMemoryRuntimeSessionRepository sessions =
                new InMemoryRuntimeSessionRepository();
        sessions.findOrCreate(new RuntimeSessionRecord(
                new RuntimeSession("harness", "session-a", "bootstrap", SCOPE),
                "binding", 1, RuntimeSessionRecord.State.ACQUIRING, 0, START));
        sessions.findOrCreate(new RuntimeSessionRecord(
                new RuntimeSession("harness", "session-b", "bootstrap", SCOPE),
                "binding", 2, RuntimeSessionRecord.State.ACQUIRING, 0, START));
        assertEquals(1, sessions.countActiveByBinding("binding", 1));
        assertEquals(1, sessions.countActiveByBinding("binding", 2));
    }

    /** M17: attempt to observe a terminal binding through findActive. */
    @Test
    void m17TerminalBindingIsNotReportedAsActive() {
        MutableClock clock = new MutableClock(START);
        InMemoryRuntimeBindingRepository repository = repo(clock);
        RuntimeBindingRecord created = repository.findOrCreate(REQUEST);
        RuntimeBindingRecord claimed = repository.claimOperation(
                created.getBindingId(), "owner", LEASE);
        RuntimeBindingRecord released = repository.compareAndSet(claimed,
                claimed.withState(RuntimeBindingRecord.State.RELEASED, null, START));
        assertNotNull(released);
        assertNull(repository.findActive(REQUEST));
    }

    private static final class MutableClock extends Clock {
        private Instant current;

        MutableClock(Instant current) {
            this.current = current;
        }

        void advance(Duration duration) {
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
        public Instant instant() {
            return current;
        }
    }
}
