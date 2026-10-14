package com.alibaba.qwen.code.managedagent.store;

import com.alibaba.qwen.code.managedagent.store.ManagedSessionStoreModels.AcquireWriterRequest;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * PR #14178 verification probe (not part of the PR). Identical file in every arm.
 * Prints "PROBE ..." lines; assertions are left out on purpose so every arm reports.
 */
class Pr14178ProbeMySqlIT {
    private static String schema;
    private static DriverManagerDataSource source;
    private static ManagedSchemaJdbcTemplate admin;

    @BeforeAll
    static void migrate() {
        var root = new DriverManagerDataSource(required("mysql.url"), required("mysql.user"),
                System.getProperty("mysql.password", ""));
        admin = new ManagedSchemaJdbcTemplate(root);
        schema = "pr14178_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        admin.execute("CREATE DATABASE " + schema);
        source = new DriverManagerDataSource(
                root.getUrl().replaceFirst("/[^/?]+(?=\\?|$)", "/" + schema),
                required("mysql.user"), System.getProperty("mysql.password", ""));
        Flyway.configure().dataSource(source).locations("classpath:db/managed-schema").load().migrate();
        var jdbc = new ManagedSchemaJdbcTemplate(source);
        System.out.println("PROBE engine=" + jdbc.queryForObject("SELECT VERSION()", String.class)
                + " schema=" + schema);
    }

    @AfterAll
    static void drop() {
        admin.execute("DROP DATABASE " + schema);
    }

    private static TransactionTemplate tx() {
        var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        tx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        tx.setTimeout(30);
        return tx;
    }

    private static AcquireWriterRequest request(String writer) {
        return new AcquireWriterRequest("workspace", writer, 60000L);
    }

    /** P1: what a first writer leaves behind for the Session root. */
    @Test
    void p1FirstWriterRootSideEffects() {
        var jdbc = new ManagedSchemaJdbcTemplate(source);
        var store = new ManagedSessionStore(jdbc);
        tx().execute(status -> store.acquireWriter("p1-tenant", "p1-session", "p".repeat(32),
                request("writer-p1")));
        long streams = jdbc.queryForObject("SELECT COUNT(*) FROM ma_event_stream WHERE tenant_id = ?"
                + " AND session_id = ? AND stream_kind = 'SESSION'", Long.class, "p1-tenant", "p1-session");
        long roots = jdbc.queryForObject("SELECT COUNT(*) FROM ma_session WHERE tenant_id = ?"
                + " AND session_id = ?", Long.class, "p1-tenant", "p1-session");
        System.out.println("PROBE p1 ma_session_rows=" + roots + " ma_event_stream_SESSION_rows=" + streams);

        // Legacy root with a NULL scope key: does a writer acquisition backfill it?
        jdbc.update("INSERT INTO ma_session (tenant_id, session_id, session_kind, created_at, updated_at)"
                + " VALUES ('p1-tenant', 'p1-legacy', 'CONTROL', 1, 1)");
        tx().execute(status -> store.acquireWriter("p1-tenant", "p1-legacy", "q".repeat(32),
                request("writer-p1l")));
        String scope = jdbc.queryForObject("SELECT CASE WHEN session_scope_key IS NULL THEN 'NULL'"
                + " ELSE 'set' END FROM ma_session WHERE tenant_id = 'p1-tenant' AND session_id = 'p1-legacy'",
                String.class);
        long legacyStreams = jdbc.queryForObject("SELECT COUNT(*) FROM ma_event_stream WHERE tenant_id ="
                + " 'p1-tenant' AND session_id = 'p1-legacy' AND stream_kind = 'SESSION'", Long.class);
        System.out.println("PROBE p1 legacy_root_scope_key_after_acquire=" + scope
                + " legacy_SESSION_stream_rows=" + legacyStreams);
    }

    /**
     * P2: deterministic interleaving. Writer re-acquisition of an existing Session pauses right
     * after its first statement on the ma_session root; an output-retention head lock on the same
     * Session then runs; the writer resumes.
     */
    @Test
    void p2ReacquireVersusOutputRetentionHeadLock() throws Exception {
        for (int round = 1; round <= 5; round++) {
            String tenant = "p2-tenant-" + round;
            String session = "p2-session-" + round;
            String token = "r".repeat(32);
            var plain = new ManagedSchemaJdbcTemplate(source);
            new ManagedSessionStore(plain);
            tx().execute(status -> new ManagedSessionStore(plain).acquireWriter(tenant, session, token,
                    request("writer-p2")));
            if (!Boolean.getBoolean("probe.freshGuard")) {
                // Steady state: the tenant's output_publication guard row already exists.
                tx().execute(status -> {
                    ToolPublicationRetentionStore.lockTenant(plain, tenant);
                    return null;
                });
            }

            var armed = new AtomicBoolean(true);
            var paused = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            var pausing = new ManagedSchemaJdbcTemplate(source) {
                @Override
                public int update(String sql, Object... arguments) {
                    int result = super.update(sql, arguments);
                    if (sql.startsWith("INSERT IGNORE INTO ma_session (")
                            && "paused".equals(Thread.currentThread().getName())
                            && armed.getAndSet(false)) {
                        paused.countDown();
                        try {
                            release.await(20, TimeUnit.SECONDS);
                        } catch (InterruptedException error) {
                            throw new IllegalStateException(error);
                        }
                    }
                    return result;
                }
            };
            var store = new ManagedSessionStore(pausing);
            var writerError = new AtomicReference<Throwable>();
            var headError = new AtomicReference<Throwable>();
            long deadlocksBefore = deadlocks(plain);
            long started = System.nanoTime();
            var writer = new Thread(() -> {
                try {
                    tx().execute(status -> store.acquireWriter(tenant, session, token, request("writer-p2")));
                } catch (Throwable error) {
                    writerError.set(error);
                }
            }, "paused");
            writer.start();
            boolean reached = paused.await(15, TimeUnit.SECONDS);
            var head = new Thread(() -> {
                try {
                    tx().execute(status -> ToolPublicationRetentionStore.lockSessionHead(plain, tenant, session));
                } catch (Throwable error) {
                    headError.set(error);
                }
            }, "head");
            head.start();
            int waiting = waitForLockWaits(plain, 1, 10_000);
            String blockedOn = blockedStatement(plain);
            release.countDown();
            writer.join(40_000);
            head.join(40_000);
            long elapsedMs = (System.nanoTime() - started) / 1_000_000;
            System.out.println("PROBE p2 round=" + round + " writerPaused=" + reached
                    + " headLockWaitersWhilePaused=" + waiting
                    + " headBlockedOn=[" + blockedOn + "]"
                    + " writer=" + outcome(writerError.get())
                    + " outputHead=" + outcome(headError.get())
                    + " deadlockDelta=" + (deadlocks(plain) - deadlocksBefore)
                    + " elapsedMs=" + elapsedMs);
        }
    }

    /** P3: the same pair without any pause, many times, to see whether it happens on its own. */
    @Test
    void p3NaturalRace() throws Exception {
        int rounds = Integer.getInteger("probe.rounds", 200);
        var plain = new ManagedSchemaJdbcTemplate(source);
        var store = new ManagedSessionStore(plain);
        int writerDeadlocks = 0;
        int headDeadlocks = 0;
        int otherErrors = 0;
        List<String> others = new ArrayList<>();
        long deadlocksBefore = deadlocks(plain);
        try (var pool = Executors.newFixedThreadPool(2)) {
            for (int round = 0; round < rounds; round++) {
                String tenant = "p3-tenant-" + round;
                String session = "p3-session";
                String token = "s".repeat(32);
                tx().execute(status -> store.acquireWriter(tenant, session, token, request("writer-p3")));
                tx().execute(status -> {
                    ToolPublicationRetentionStore.lockTenant(plain, tenant);
                    return null;
                });
                var barrier = new CyclicBarrier(2);
                Future<?> writer = pool.submit(() -> {
                    barrier.await();
                    return tx().execute(status -> store.acquireWriter(tenant, session, token,
                            request("writer-p3")));
                });
                Future<?> head = pool.submit(() -> {
                    barrier.await();
                    spin(ThreadLocalRandom.current().nextInt(0, 4_000_000));
                    return tx().execute(status ->
                            ToolPublicationRetentionStore.lockSessionHead(plain, tenant, session));
                });
                for (int side = 0; side < 2; side++) {
                    try {
                        (side == 0 ? writer : head).get(60, TimeUnit.SECONDS);
                    } catch (java.util.concurrent.ExecutionException error) {
                        if (isDeadlock(error.getCause())) {
                            if (side == 0) {
                                writerDeadlocks++;
                            } else {
                                headDeadlocks++;
                            }
                        } else {
                            otherErrors++;
                            if (others.size() < 3) {
                                others.add(error.getCause().toString());
                            }
                        }
                    }
                }
            }
        }
        System.out.println("PROBE p3 rounds=" + rounds + " writerDeadlockLosers=" + writerDeadlocks
                + " outputHeadDeadlockLosers=" + headDeadlocks + " otherErrors=" + otherErrors
                + " engineDeadlockDelta=" + (deadlocks(plain) - deadlocksBefore) + " " + others);
    }

    private static void spin(long nanos) {
        long until = System.nanoTime() + nanos;
        while (System.nanoTime() < until) {
            Thread.onSpinWait();
        }
    }

    private static int waitForLockWaits(ManagedSchemaJdbcTemplate jdbc, int expected, long timeoutMs)
            throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        int seen = 0;
        while (System.currentTimeMillis() < deadline) {
            seen = jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.innodb_trx t JOIN"
                    + " information_schema.processlist p ON p.id = t.trx_mysql_thread_id WHERE"
                    + " t.trx_state = 'LOCK WAIT' AND p.db = DATABASE()", Integer.class);
            if (seen >= expected) {
                return seen;
            }
            Thread.sleep(200);
        }
        return seen;
    }

    private static String blockedStatement(ManagedSchemaJdbcTemplate jdbc) {
        var rows = jdbc.queryForList("SELECT t.trx_query FROM information_schema.innodb_trx t JOIN"
                + " information_schema.processlist p ON p.id = t.trx_mysql_thread_id WHERE"
                + " t.trx_state = 'LOCK WAIT' AND p.db = DATABASE()", String.class);
        if (rows.isEmpty() || rows.getFirst() == null) {
            return "none";
        }
        String query = rows.getFirst().replaceAll("\\s+", " ");
        return query.length() > 70 ? query.substring(0, 70) + "…" : query;
    }

    private static long deadlocks(ManagedSchemaJdbcTemplate jdbc) {
        String version = jdbc.queryForObject("SELECT VERSION()", String.class);
        if (version.toLowerCase().contains("mariadb")) {
            return jdbc.queryForObject("SELECT VARIABLE_VALUE FROM information_schema.global_status"
                    + " WHERE VARIABLE_NAME = 'INNODB_DEADLOCKS'", Long.class);
        }
        return jdbc.queryForObject("SELECT count FROM information_schema.innodb_metrics WHERE name ="
                + " 'lock_deadlocks'", Long.class);
    }

    private static boolean isDeadlock(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql && (sql.getErrorCode() == 1213
                    || "40001".equals(sql.getSQLState()))) {
                return true;
            }
            if (cause.getMessage() != null && cause.getMessage().contains("Deadlock")) {
                return true;
            }
        }
        return false;
    }

    private static String outcome(Throwable error) {
        if (error == null) {
            return "OK";
        }
        if (isDeadlock(error)) {
            return "DEADLOCK(" + error.getClass().getSimpleName() + ")";
        }
        String message = String.valueOf(error.getMessage()).replaceAll("\\s+", " ");
        return "ERR(" + error.getClass().getSimpleName() + ": "
                + (message.length() > 90 ? message.substring(0, 90) : message) + ")";
    }

    private static String required(String name) {
        String value = System.getProperty(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }
}
