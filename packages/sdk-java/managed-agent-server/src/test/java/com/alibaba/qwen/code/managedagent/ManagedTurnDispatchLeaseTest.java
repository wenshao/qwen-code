package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.config.ManagedAgentProperties;
import com.alibaba.qwen.code.managedagent.store.ManagedAgentStore;
import com.alibaba.qwen.code.managedagent.store.ManagedSchemaJdbcTemplate;
import com.alibaba.qwen.code.managedagent.store.ManagedWorkspaceRegistry;
import com.alibaba.qwen.code.managedagent.store.StoreModels.DispatchTarget;
import com.alibaba.qwen.code.managedagent.store.StoreModels.HarnessEvent;
import com.alibaba.qwen.code.managedagent.store.StoreModels.ProjectedEvent;
import com.alibaba.qwen.code.managedagent.store.StoreModels.TurnRecord;
import com.alibaba.qwen.code.runtimebroker.managedschema.ManagedSchema;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The Turn dispatch lease between nodes whose application clocks run ten
 * minutes off the database's, far beyond the one-minute lease (#14248).
 * Claims, renewals, owner guards and retry waits all read database time,
 * so no node's own clock can misjudge a claim.
 */
class ManagedTurnDispatchLeaseTest {
    private static final String TENANT = "dispatch-lease";
    private static final Duration LEASE = Duration.ofMinutes(1);
    private static final Duration SKEW = Duration.ofMinutes(10);
    private JdbcTemplate jdbc;

    @BeforeEach
    void database() {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:dispatch-lease-" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        ManagedSchema.initialize(dataSource);
        jdbc = new ManagedSchemaJdbcTemplate(dataSource);
    }

    @Test
    void aNodeAheadLeavesALiveClaimToItsOwner() {
        ManagedAgentStore normal = node(Duration.ZERO);
        ManagedAgentStore ahead = node(SKEW);
        DispatchTarget turn = turn(normal);

        long before = databaseTime();
        claim(normal, turn, "normal");
        long after = databaseTime();
        assertThat(lease(normal, turn)).isBetween(before + LEASE.toMillis(),
                after + LEASE.toMillis());

        assertThat(ahead.findDispatchable(10)).doesNotContain(turn);
        assertThat(ahead.claimTurn(TENANT, turn.sessionId(), turn.turnId(),
                "ahead", LEASE)).isEmpty();
        assertThat(normal.renewTurn(TENANT, turn.sessionId(), turn.turnId(),
                "normal", LEASE)).isTrue();
        assertThat(record(normal, turn).dispatchOwner()).isEqualTo("normal");
    }

    @Test
    void aNodeBehindKeepsItsClaimAndTakesOverALapsedOneAtOnce() {
        ManagedAgentStore normal = node(Duration.ZERO);
        ManagedAgentStore behind = node(SKEW.negated());
        DispatchTarget held = turn(normal);

        long before = databaseTime();
        claim(behind, held, "behind");
        assertThat(behind.renewTurn(TENANT, held.sessionId(), held.turnId(),
                "behind", LEASE)).isTrue();
        long after = databaseTime();
        assertThat(lease(normal, held)).isBetween(before + LEASE.toMillis(),
                after + LEASE.toMillis());
        assertThat(normal.findDispatchable(10)).doesNotContain(held);
        assertThat(normal.claimTurn(TENANT, held.sessionId(), held.turnId(),
                "normal", LEASE)).isEmpty();

        // The normal node dies holding another Turn. Once its claim lapses by
        // database time, the node behind takes it over, not a skew later.
        DispatchTarget orphan = turn(normal);
        claim(normal, orphan, "normal");
        assertThat(behind.findDispatchable(10)).doesNotContain(orphan);
        lapse(orphan);
        assertThat(behind.findDispatchable(10)).contains(orphan);
        claim(behind, orphan, "behind");
    }

    @Test
    void anOwnerAheadPassesEveryGuardOfItsLiveClaim() {
        ManagedAgentStore ahead = node(SKEW);
        DispatchTarget turn = turn(ahead);
        String session = turn.sessionId();
        String turnId = turn.turnId();
        claim(ahead, turn, "ahead");

        assertThat(ahead.renewTurn(TENANT, session, turnId, "ahead", LEASE))
                .isTrue();
        assertThat(ahead.bindHarness(TENANT, session, turnId, "ahead",
                "boot-a")).isTrue();
        ahead.markSubmissionAttempted(TENANT, session, turnId, "ahead");
        assertThat(ahead.withdrawSubmissionAttempted(TENANT, session, turnId,
                "ahead")).isTrue();
        ahead.markSubmissionAttempted(TENANT, session, turnId, "ahead");
        ahead.recordAdmission(TENANT, session, turnId, "ahead", "epoch-a", 0);
        assertThat(ahead.bindRecoveredHarness(TENANT, session, turnId,
                "ahead", "boot-a", "boot-b")).isTrue();
        ahead.recordRecoveryAdmission(TENANT, session, turnId, "ahead",
                "epoch-a", "epoch-a", "epoch-b", 0);
        ahead.retractContinuationOutput(TENANT, session, turnId, "ahead",
                "boot-b", "epoch-b");
        ahead.recordHarnessEvents(TENANT, session, turnId, "ahead", "epoch-b",
                List.of(new HarnessEvent(1, "boot-b:epoch-b:1", null)));
        ahead.retractHarnessTurnOutput(TENANT, session, turnId, "ahead",
                "epoch-b", 1, 2);
        ahead.recordHarnessEvents(TENANT, session, turnId, "ahead", "epoch-b",
                List.of(new HarnessEvent(3, "boot-b:epoch-b:3",
                        new ProjectedEvent("turn.completed",
                                Map.of("turnId", turnId), true, "COMPLETED",
                                null, null))));
        assertThat(record(ahead, turn).status()).isEqualTo("COMPLETED");

        DispatchTarget cancelled = turn(ahead);
        claim(ahead, cancelled, "ahead");
        ahead.cancelBeforeAdmission(TENANT, cancelled.sessionId(),
                cancelled.turnId(), "ahead");
        assertThat(record(ahead, cancelled).status()).isEqualTo("CANCELLED");

        DispatchTarget failed = turn(ahead);
        claim(ahead, failed, "ahead");
        ahead.failTurn(TENANT, failed.sessionId(), failed.turnId(), "ahead",
                "probe_failed", "probe");
        assertThat(record(ahead, failed).status()).isEqualTo("FAILED");
    }

    @Test
    void anOwnerBehindIsFencedOnceItsClaimLapses() {
        ManagedAgentStore behind = node(SKEW.negated());
        DispatchTarget turn = turn(behind);
        String session = turn.sessionId();
        String turnId = turn.turnId();
        claim(behind, turn, "behind");
        lapse(turn);

        assertThat(behind.renewTurn(TENANT, session, turnId, "behind", LEASE))
                .isFalse();
        assertThat(behind.bindHarness(TENANT, session, turnId, "behind",
                "boot-a")).isFalse();
        assertThatThrownBy(() -> behind.markSubmissionAttempted(TENANT,
                session, turnId, "behind"))
                .hasMessage("Turn dispatch lease was lost");
        assertThatThrownBy(() -> behind.recordAdmission(TENANT, session,
                turnId, "behind", "epoch-a", 0))
                .hasMessage("Turn dispatch lease was lost");
        assertThatThrownBy(() -> behind.recordHarnessEvents(TENANT, session,
                turnId, "behind", "epoch-a",
                List.of(new HarnessEvent(1, "boot-a:epoch-a:1", null))))
                .hasMessage("Turn dispatch lease was lost");
        behind.cancelBeforeAdmission(TENANT, session, turnId, "behind");
        behind.failTurn(TENANT, session, turnId, "behind", "probe_failed",
                "probe");
        assertThat(record(behind, turn).status()).isEqualTo("ACCEPTED");
    }

    @Test
    void aRetryWaitCountsFromDatabaseTime() {
        ManagedAgentStore normal = node(Duration.ZERO);
        ManagedAgentStore ahead = node(SKEW);
        DispatchTarget turn = turn(normal);
        Duration delay = Duration.ofSeconds(30);

        // A wait the normal node set holds against the node ahead.
        claim(normal, turn, "normal");
        normal.scheduleTurnRetry(TENANT, turn.sessionId(), turn.turnId(),
                "normal", delay);
        assertThat(record(normal, turn).dispatchOwner()).isNull();
        assertThat(ahead.findDispatchable(10)).doesNotContain(turn);
        assertThat(ahead.claimTurn(TENANT, turn.sessionId(), turn.turnId(),
                "ahead", LEASE)).isEmpty();

        // A wait the node ahead sets is counted from database time, so the
        // normal node meets it on time, not the skew later.
        endWait(turn);
        claim(ahead, turn, "ahead");
        long before = databaseTime();
        ahead.scheduleTurnRetry(TENANT, turn.sessionId(), turn.turnId(),
                "ahead", delay);
        long after = databaseTime();
        assertThat(record(normal, turn).retryAfter()).isBetween(
                before + delay.toMillis(), after + delay.toMillis());
        assertThat(normal.findDispatchable(10)).doesNotContain(turn);
        endWait(turn);
        assertThat(normal.findDispatchable(10)).contains(turn);
        claim(normal, turn, "normal");
    }

    private ManagedAgentStore node(Duration skew) {
        return new ManagedAgentStore(jdbc, new ObjectMapper(),
                Clock.offset(Clock.systemUTC(), skew), ignored -> {},
                new ManagedWorkspaceRegistry(jdbc),
                new ManagedAgentProperties());
    }

    private static DispatchTarget turn(ManagedAgentStore store) {
        String sessionId = store.insertSessionCommand(TENANT,
                "CREATE_SESSION", UUID.randomUUID().toString(), "digest",
                "qwen-code", null, null, List.of(), null).sessionId();
        String turnId = store.insertTurnCommand(TENANT, "SUBMIT_TURN",
                UUID.randomUUID().toString(), "digest", sessionId, List.of(),
                "payload").turnId();
        return new DispatchTarget(TENANT, sessionId, turnId);
    }

    private static void claim(ManagedAgentStore store, DispatchTarget turn,
            String owner) {
        assertThat(store.claimTurn(TENANT, turn.sessionId(), turn.turnId(),
                owner, LEASE)).isPresent();
    }

    private static TurnRecord record(ManagedAgentStore store,
            DispatchTarget turn) {
        return store.findTurn(TENANT, turn.sessionId(), turn.turnId())
                .orElseThrow();
    }

    private static long lease(ManagedAgentStore store, DispatchTarget turn) {
        return record(store, turn).dispatchLeaseUntil();
    }

    /** Ends a claim by database time, as its owner's death would. */
    private void lapse(DispatchTarget turn) {
        jdbc.update("UPDATE ma_turn SET dispatch_lease_until = ? WHERE"
                        + " tenant_id = ? AND session_id = ? AND turn_id = ?",
                databaseTime() - 1, TENANT, turn.sessionId(), turn.turnId());
    }

    private void endWait(DispatchTarget turn) {
        jdbc.update("UPDATE ma_turn SET retry_after = ? WHERE tenant_id = ?"
                        + " AND session_id = ? AND turn_id = ?",
                databaseTime(), TENANT, turn.sessionId(), turn.turnId());
    }

    private long databaseTime() {
        return jdbc.queryForObject("SELECT UNIX_TIMESTAMP(),"
                        + " EXTRACT(MICROSECOND FROM CURRENT_TIMESTAMP(6))",
                (row, index) -> row.getLong(1) * 1000
                        + row.getLong(2) / 1000);
    }
}
