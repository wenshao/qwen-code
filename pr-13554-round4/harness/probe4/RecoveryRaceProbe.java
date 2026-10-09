package com.alibaba.qwen.code.managedagent.store;

import com.alibaba.qwen.code.managedagent.api.WorkspaceSelection;
import com.alibaba.qwen.code.managedagent.config.ManagedAgentProperties;
import com.alibaba.qwen.code.managedagent.config.ManagedAgentProperties.RuntimeBroker.WorkspaceMount;
import com.alibaba.qwen.code.runtimebroker.WorkspaceExecutionProfile;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Verification-only (not part of the PR). Interleaves the production workspace-recovery registration
 * (WorkspaceRecoveryStore capture constructor) with the production stream-capture collector's claim/page
 * on a real MySQL/MariaDB schema, and prints RESULT lines. Each scenario uses a fresh schema.
 */
class RecoveryRaceProbe {
    static final String ARM = System.getProperty("probe.arm", "?");
    static final String DB = System.getProperty("probe.db", "?");

    @Test
    void probe() throws Exception {
        for (String scenario : System.getProperty("probe.scenarios", "inflight,gap,collectorFirst,stress").split(",")) {
            switch (scenario) {
                case "inflight" -> inflight();
                case "gap" -> gap();
                case "collectorFirst" -> collectorFirst();
                case "stress" -> stress(Integer.getInteger("probe.rounds", 30));
                case "footprint" -> footprint();
                case "recapture" -> recapture();
                default -> throw new IllegalArgumentException(scenario);
            }
        }
    }

    static volatile String isolation = "?";

    static void result(String scenario, String body) {
        System.out.println("RESULT arm=" + ARM + " db=" + DB + " isolation=" + isolation + " scenario=" + scenario + " " + body);
    }

    /** Registration inserts S's pin row, then stays uncommitted for 3 s; the page runs inside that window. */
    void inflight() throws Exception {
        try (var rig = new Rig()) {
            String s = rig.retiredSessionWithRows(3);
            var claim = rig.claim();
            var pinned = new CountDownLatch(1);
            var registrar = rig.registrar(s, pinned, 3000);
            var reg = new Thread(() -> rig.register(registrar), "registrar");
            reg.start();
            boolean pinnedInTime = pinned.await(30, TimeUnit.SECONDS);
            long t0 = System.nanoTime();
            String page = rig.collect(claim);
            long pageMs = (System.nanoTime() - t0) / 1_000_000;
            reg.join(60_000);
            result("inflight", "pinnedBeforePage=" + pinnedInTime + " page=" + page + " pageMs=" + pageMs
                    + " registrar=" + registrar.outcome + " " + rig.state(s));
        }
    }

    /** Registration commits after claim() and before the page transaction starts. */
    void gap() throws Exception {
        try (var rig = new Rig()) {
            String s = rig.retiredSessionWithRows(3);
            var claim = rig.claim();
            var registrar = rig.registrar(s, null, 0);
            rig.register(registrar);
            String page = rig.collect(claim);
            result("gap", "page=" + page + " registrar=" + registrar.outcome + " " + rig.state(s));
        }
    }

    /**
     * The page passes its re-check first and pauses 3 s before the byte drop; registration starts in the
     * pause. Afterwards the capture reads S's collected row, and a second retired Session T of the same cut
     * is offered to the collector.
     */
    void collectorFirst() throws Exception {
        try (var rig = new Rig()) {
            String s = rig.retiredSessionWithRows(3);
            String t = rig.retiredSessionWithRows(2);
            rig.pauseBeforeDropMs = 3000;
            rig.onlyScope = ManagedSessionStore.sessionScopeKey("tenant", s);
            var claim = rig.claimFor(s);
            var paused = new CountDownLatch(1);
            rig.dropReached = paused;
            var page = new String[1];
            var pager = new Thread(() -> page[0] = rig.collect(claim), "pager");
            pager.start();
            boolean reached = paused.await(30, TimeUnit.SECONDS);
            var registrar = rig.registrar(s, null, 0);
            long r0 = System.nanoTime();
            rig.register(registrar);
            long regMs = (System.nanoTime() - r0) / 1_000_000;
            pager.join(60_000);
            rig.pauseBeforeDropMs = 0;
            rig.onlyScope = null;
            String read = registrar.store == null ? "no-store" : rig.readCollected(registrar.store, s);
            String op = registrar.store == null ? "no-store" : registrar.store.inspect().path("state").asText();
            // T was retired and pinned by the same cut; offer it to the collector a few times.
            String tOutcome = rig.collectAllFor(t);
            result("collectorFirst", "dropReachedBeforeRegistration=" + reached + " page=" + page[0]
                    + " registrar=" + registrar.outcome + " registrarMs=" + regMs + " " + rig.state(s)
                    + " captureRead=" + read + " opAfterRead=" + op + " secondSessionT=" + tOutcome);
        }
    }


    /**
     * Lock footprint of the page-time locking re-check: 300 historical pins of other Sessions exist; the
     * page holds its locks (paused before the byte drop) while an unrelated pin row is inserted on another
     * connection in autocommit. Measures that insert's latency and the page transaction's locked rows.
     */
    void footprint() throws Exception {
        try (var rig = new Rig()) {
            String s = rig.retiredSessionWithRows(3);
            String hist = UUID.randomUUID().toString();
            rig.jdbc.update("INSERT INTO managed_workspace_recovery_operation (operation_id, tenant_id, storage_id, mode,"
                    + " capture_operation_id, request_digest, request_json, registration_json, source_digest, session_count,"
                    + " state, created_at, updated_at) VALUES (?, 'tenant', 'storage', 'capture', NULL, ?, '{}', '{}', ?, 0,"
                    + " 'INVALIDATED', CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))", hist, "a".repeat(64), "b".repeat(64));
            for (int i = 0; i < 300; i++) {
                rig.jdbc.update("INSERT INTO managed_workspace_recovery_session (operation_id, session_id, source_digest,"
                        + " source_json, state) VALUES (?, ?, ?, '{}', 'PENDING')", hist, UUID.randomUUID().toString(), "c".repeat(64));
            }
            rig.pauseBeforeDropMs = 3000;
            var claim = rig.claimFor(s);
            var paused = new CountDownLatch(1);
            rig.dropReached = paused;
            var page = new String[1];
            var pager = new Thread(() -> page[0] = rig.collect(claim), "pager");
            pager.start();
            boolean reached = paused.await(30, TimeUnit.SECONDS);
            String locked = rig.admin.queryForList("SELECT trx_rows_locked FROM information_schema.innodb_trx"
                    + " ORDER BY trx_rows_locked DESC LIMIT 1").toString();
            // An unrelated Session id that sorts far from S in either direction.
            String unrelated = (s.charAt(0) < '8' ? "f" : "0") + UUID.randomUUID().toString().substring(1);
            long t0 = System.nanoTime();
            String insert;
            try {
                rig.jdbc.update("INSERT INTO managed_workspace_recovery_session (operation_id, session_id, source_digest,"
                        + " source_json, state) VALUES (?, ?, ?, '{}', 'PENDING')", hist, unrelated, "d".repeat(64));
                insert = "ok";
            } catch (RuntimeException error) {
                insert = "error:" + error.getClass().getSimpleName();
            }
            long insertMs = (System.nanoTime() - t0) / 1_000_000;
            pager.join(60_000);
            result("footprint", "dropReached=" + reached + " page=" + page[0] + " pageTrxRowsLocked=" + locked
                    + " unrelatedPinInsert=" + insert + " unrelatedPinInsertMs=" + insertMs);
        }
    }


    /**
     * After S's stream-capture rows are collected, two independent capture registrations of the same storage
     * each list S again and each read S's collected row (the read the TS worker makes when it walks a Shell
     * manifest's pages). A third retired Session T of the cut shows what the outcome does to the collector.
     */
    void recapture() throws Exception {
        try (var rig = new Rig()) {
            String s = rig.retiredSessionWithRows(3);
            String t = rig.retiredSessionWithRows(2);
            rig.jdbc.update("UPDATE qwen_managed_session_resource_collection SET gc_next_at = 9000000000000 WHERE session_id = ?", t);
            var claim = rig.claimFor(s);
            String page = rig.collect(claim);
            for (int attempt = 1; attempt <= 2; attempt++) {
                rig.request.put("operationId", UUID.randomUUID().toString());
                var registrar = rig.registrar(s, null, 0);
                rig.register(registrar);
                boolean listed = false;
                if (registrar.store != null) {
                    var listing = registrar.store.call("sessions", WorkspaceRecoveryStore.JSON.createObjectNode());
                    for (var row : listing.path("sessions")) {
                        listed |= s.equals(row.path("sessionId").asText());
                    }
                }
                String read = registrar.store == null ? "no-store" : rig.readCollected(registrar.store, s);
                String op = registrar.store == null ? "no-store" : registrar.store.inspect().path("state").asText();
                result("recapture", "attempt=" + attempt + " firstPage=" + page + " registrar=" + registrar.outcome
                        + " sListedInCut=" + listed + " captureReadOfS=" + read + " opAfterRead=" + op);
            }
            result("recapture", "attempt=after secondSessionT=" + rig.collectAllFor(t));
        }
    }

    /** No injected pauses: registration and page start together with random offsets, after claim(). */
    void stress(int rounds) throws Exception {
        var random = new Random(1354);
        int violations = 0, deferred = 0, collectorFirst = 0, pageErrors = 0, regErrors = 0, retries = 0;
        long maxRegMs = 0, maxPageMs = 0;
        var errorKinds = new java.util.TreeMap<String, Integer>();
        for (int round = 0; round < rounds; round++) {
            try (var rig = new Rig()) {
                for (int f = 0; f < 4; f++) {
                    rig.retiredSessionWithRows(1);
                }
                String s = rig.retiredSessionWithRows(3);
                rig.onlyScope = ManagedSessionStore.sessionScopeKey("tenant", s);
                var claim = rig.claimFor(s);
                var registrar = rig.registrar(s, null, 0);
                var start = new CountDownLatch(1);
                int regDelay = random.nextInt(25);
                int pageDelay = random.nextInt(25);
                var page = new String[1];
                var pageMs = new long[1];
                var regMs = new long[1];
                var reg = new Thread(() -> {
                    await(start); sleep(regDelay);
                    long t0 = System.nanoTime(); rig.register(registrar); regMs[0] = (System.nanoTime() - t0) / 1_000_000;
                });
                var pager = new Thread(() -> {
                    await(start); sleep(pageDelay);
                    long t0 = System.nanoTime(); page[0] = rig.collect(claim); pageMs[0] = (System.nanoTime() - t0) / 1_000_000;
                });
                reg.start(); pager.start(); start.countDown();
                reg.join(120_000); pager.join(120_000);
                maxRegMs = Math.max(maxRegMs, regMs[0]);
                maxPageMs = Math.max(maxPageMs, pageMs[0]);
                retries += Math.max(0, registrar.attempts.get() - 1);
                boolean dropped = rig.dropAt.get() != 0;
                boolean registered = "ok".equals(registrar.outcome);
                if (page[0] != null && page[0].startsWith("error")) {
                    pageErrors++;
                    errorKinds.merge("page:" + page[0], 1, Integer::sum);
                }
                if (!registered) {
                    regErrors++;
                    errorKinds.merge("registrar:" + registrar.outcome, 1, Integer::sum);
                }
                if (dropped && registered && registrar.pinnedAt.get() != 0 && registrar.pinnedAt.get() < rig.dropAt.get()) {
                    violations++;
                } else if (dropped) {
                    collectorFirst++;
                } else {
                    deferred++;
                }
            }
        }
        result("stress", "rounds=" + rounds + " violations=" + violations + " deferred=" + deferred
                + " collectorFirst=" + collectorFirst + " pageErrors=" + pageErrors + " registrarErrors=" + regErrors
                + " registrarRetries=" + retries + " maxRegistrarMs=" + maxRegMs + " maxPageMs=" + maxPageMs
                + " errors=" + errorKinds);
    }

    static void await(CountDownLatch latch) {
        try { latch.await(); } catch (InterruptedException e) { throw new IllegalStateException(e); }
    }

    static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { throw new IllegalStateException(e); }
    }

    /** One fresh schema with the WorkspaceRecoveryStoreTest fixture (tenant, storage, workspace-a). */
    static final class Rig implements AutoCloseable {
        final JdbcTemplate admin;
        final String schema;
        final DataSource source;
        final JdbcTemplate jdbc;
        final DataSourceTransactionManager manager;
        final WorkspaceStorageGuard guard;
        final ManagedAgentStore sessions;
        final ObjectNode request;
        final Path temporary;
        final SessionResourceCollectionCollector collector;
        volatile long pauseBeforeDropMs;
        volatile String onlyScope;
        volatile CountDownLatch dropReached;
        final AtomicLong dropAt = new AtomicLong();

        Rig() throws Exception {
            String url = System.getProperty("mysql.url");
            String user = System.getProperty("mysql.user");
            String password = System.getProperty("mysql.password", "");
            admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
            schema = "race_" + UUID.randomUUID().toString().replace("-", "");
            admin.execute("CREATE DATABASE " + schema);
            source = new DriverManagerDataSource(url.replaceFirst("/[^/?]+(?=\\?|$)", "/" + schema), user, password);
            Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
            jdbc = new JdbcTemplate(source);
            manager = new DataSourceTransactionManager(source);
            try {
                isolation = jdbc.queryForObject("SELECT @@SESSION.transaction_isolation", String.class);
            } catch (RuntimeException mariadb) {
                isolation = jdbc.queryForObject("SELECT @@SESSION.tx_isolation", String.class);
            }
            temporary = Files.createTempDirectory("race");
            Path root = Files.createDirectory(temporary.resolve("source")).toRealPath();
            Path bundle = Files.createDirectory(temporary.resolve("bundle")).toRealPath();
            var properties = new ManagedAgentProperties();
            properties.getHarness().setCapabilityDigest("a".repeat(64));
            properties.getRuntimeBroker().setVerifiedWorkspaceRecoveryEnabled(true);
            properties.getRuntimeBroker().setWorkspaceMounts(List.of(new WorkspaceMount("tenant", "storage", root.toString())));
            guard = new WorkspaceStorageGuard(jdbc, manager, properties, path -> new WorkspaceStorageGuard.Identity(
                    path.toRealPath().toString(), "test-host", "test-device", "test-inode", "2026-10-01T00:00:00Z"));
            sessions = new ManagedAgentStore(jdbc, WorkspaceRecoveryStore.JSON, Clock.systemUTC(), ignored -> { },
                    new ManagedWorkspaceRegistry(jdbc), properties);
            jdbc.update("INSERT INTO managed_workspace_registry (tenant_id, workspace_id, workspace_generation,"
                    + " storage_id, display_name, config_ref, policy_ref, state) VALUES ('tenant', 'workspace-a', 1, 'storage',"
                    + " 'Test', ?, ?, 'ACTIVE')", WorkspaceExecutionProfile.CONFIG_REF, WorkspaceExecutionProfile.POLICY_REF);
            jdbc.update("INSERT INTO managed_workspace_access (tenant_id, workspace_id, actor_id, role)"
                    + " VALUES ('tenant', 'workspace-a', ?, 'OPERATOR')", "actor".getBytes(StandardCharsets.UTF_8));
            guard.register("tenant", "storage", UUID.randomUUID().toString());
            String fence = UUID.randomUUID().toString();
            guard.fence("tenant", "storage", 1, fence);
            request = WorkspaceRecoveryStore.JSON.createObjectNode().put("version", 1)
                    .put("operationId", UUID.randomUUID().toString()).put("tenantId", "tenant").put("storageId", "storage")
                    .put("fenceOperationId", fence).put("mountRevision", 1).put("sourceRoot", root.toString())
                    .put("bundleRoot", bundle.toString()).put("fileHistoryRoot", temporary.resolve("history").toString())
                    .put("nodeExecutable", "/test/node").put("cliEntry", "/test/cli.js");
            var props = new ManagedAgentProperties();
            props.getToolPublication().setGcEnabled(true);
            props.getToolPublication().setDeletionGrace(Duration.ZERO);
            var hooked = new JdbcTemplate(source) {
                @Override public int update(String sql, Object... args) {
                    if (sql.startsWith("UPDATE qwen_managed_session_resource SET state = 'COLLECTED'")) {
                        var latch = dropReached;
                        if (latch != null) {
                            latch.countDown();
                        }
                        long pause = pauseBeforeDropMs;
                        if (pause > 0) {
                            sleep(pause);
                        }
                        dropAt.compareAndSet(0, System.nanoTime());
                    }
                    return super.update(sql, args);
                }
            };
            collector = new SessionResourceCollectionCollector(hooked, manager, props);
        }

        String session() {
            return new TransactionTemplate(manager).execute(status -> sessions.insertWorkspaceSessionCommand("tenant", "actor",
                    UUID.randomUUID().toString(), "sha256:" + "a".repeat(64), "qwen-code", null, null, List.of(), null,
                    new WorkspaceSelection("workspace-a", ".")).sessionId());
        }

        /** A Session with sealed head and N PUBLISHED stream-capture rows, then retired by the production DELETE completion. */
        String retiredSessionWithRows(int rows) {
            String s = session();
            jdbc.update("INSERT INTO qwen_managed_session_journal_head (tenant_id, workspace_id, session_id, storage_version,"
                    + " state, writer_generation, writer_id, writer_lease_until, lease_token_hash, journal_revision,"
                    + " committed_sequence, last_commit_digest, activation_epoch, compacted_through_revision, recovery_status,"
                    + " created_at, updated_at) VALUES ('tenant', 'private-key', ?, 1, 'SEALED', 1, 'original',"
                    + " '2000-01-01 00:00:00', ?, 1, 1, ?, 1, 0, 'READY', CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))",
                    s, "a".repeat(64), "b".repeat(64));
            for (int i = 0; i < rows; i++) {
                byte[] bytes = ("segment-" + s + "-" + i).repeat(64).getBytes(StandardCharsets.UTF_8);
                jdbc.update("INSERT INTO qwen_managed_session_resource (session_scope_key, tenant_id, workspace_id, session_id,"
                        + " resource_id, kind, schema_version, byte_length, sha256, storage_kind, inline_bytes, publish_command_id,"
                        + " state, created_at) VALUES (?, 'tenant', 'private-key', ?, ?, 'managed-tool-result-content', 1, ?, ?,"
                        + " 'MYSQL_INLINE', ?, 'publish', 'PUBLISHED', CURRENT_TIMESTAMP(6))",
                        ManagedSessionStore.sessionScopeKey("tenant", s), s, "seg-" + i, bytes.length,
                        WorkspaceRecoveryStore.hash(bytes), bytes);
            }
            String operation = UUID.randomUUID().toString();
            jdbc.update("UPDATE managed_agent_session SET status = 'DELETING' WHERE session_id = ?", s);
            jdbc.update("INSERT INTO managed_agent_operation (tenant_id, session_id, operation_id, operation_kind,"
                    + " actor_digest, idempotency_key, request_digest, state, admission_stage, delivery_state,"
                    + " session_status_before, lease_owner, lease_until, claim_generation, available_at, created_at,"
                    + " updated_at) VALUES ('tenant', ?, ?, 'DELETE', '', ?, 'digest', 'RUNNING', 'JAVA_DURABLE',"
                    + " 'LEASED', 'CLOSED', 'worker', 32503680000000, 1, 0, 0, 0)", s, operation, "delete-" + operation);
            Boolean done = new TransactionTemplate(manager).execute(status ->
                    sessions.completeOperation("tenant", s, operation, "worker", 1, false));
            if (!Boolean.TRUE.equals(done)) {
                throw new IllegalStateException("retirement did not complete");
            }
            return s;
        }

        void ensureLedgers() {
            try {
                var method = SessionResourceCollectionCollector.class.getDeclaredMethod("ensureLedgers");
                method.setAccessible(true);
                method.invoke(collector);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }

        SessionResourceCollectionCollector.Claim claim() {
            ensureLedgers();
            var claim = collector.claim();
            for (int i = 0; claim == null && i < 10; i++) {
                sleep(20);
                jdbc.update("UPDATE qwen_managed_session_resource_collection SET gc_next_at = 0 WHERE collected_at IS NULL");
                claim = collector.claim();
            }
            if (claim == null) {
                throw new IllegalStateException("no claim: " + jdbc.queryForList(
                        "SELECT session_id, gc_blocker, gc_next_at FROM qwen_managed_session_resource_collection"));
            }
            return claim;
        }

        /** Make every ledger except S's not due, then claim S. */
        SessionResourceCollectionCollector.Claim claimFor(String s) {
            ensureLedgers();
            jdbc.update("UPDATE qwen_managed_session_resource_collection SET gc_next_at = 9000000000000 WHERE session_id <> ?", s);
            var claim = collector.claim();
            for (int i = 0; claim == null && i < 10; i++) {
                sleep(20);
                jdbc.update("UPDATE qwen_managed_session_resource_collection SET gc_next_at = 0 WHERE session_id = ?", s);
                claim = collector.claim();
            }
            if (claim == null || !claim.session().equals(s)) {
                throw new IllegalStateException("claim was not S: " + claim);
            }
            return claim;
        }

        String collect(SessionResourceCollectionCollector.Claim claim) {
            try {
                return collector.collect(claim) ? "collected" : "deferred";
            } catch (RuntimeException error) {
                Throwable root = error;
                while (root.getCause() != null) {
                    root = root.getCause();
                }
                return "error:" + error.getClass().getSimpleName() + "/" + root.getClass().getSimpleName();
            }
        }

        /** Re-open the second Session's ledger and run the collector until it completes or blocks. */
        String collectAllFor(String t) {
            jdbc.update("UPDATE qwen_managed_session_resource_collection SET gc_next_at = 0, gc_owner = NULL,"
                    + " gc_claim_until = 0 WHERE session_id = ? AND collected_at IS NULL", t);
            for (int i = 0; i < 4; i++) {
                ensureLedgers();
                var claim = collector.claim();
                if (claim != null) {
                    collect(claim);
                }
            }
            var ledger = jdbc.queryForMap("SELECT gc_blocker, collected_at IS NOT NULL AS done FROM"
                    + " qwen_managed_session_resource_collection WHERE session_id = ?", t);
            long collected = jdbc.queryForObject("SELECT COUNT(*) FROM qwen_managed_session_resource WHERE session_id = ?"
                    + " AND state = 'COLLECTED'", Long.class, t);
            return "{blocker=" + ledger.get("gc_blocker") + ",done=" + flag(ledger.get("done")) + ",collectedRows=" + collected + "}";
        }

        Registrar registrar(String s, CountDownLatch pinned, long holdMs) {
            return new Registrar(this, s, pinned, holdMs);
        }

        void register(Registrar registrar) {
            try {
                registrar.store = new WorkspaceRecoveryStore(registrar.template, manager, guard, null, "capture",
                        request.toString().getBytes(StandardCharsets.UTF_8));
                registrar.outcome = "ok";
            } catch (RuntimeException error) {
                Throwable root = error;
                while (root.getCause() != null) {
                    root = root.getCause();
                }
                registrar.outcome = "error:" + error.getClass().getSimpleName() + "/" + root.getClass().getSimpleName();
            }
        }

        String readCollected(WorkspaceRecoveryStore store, String s) {
            var row = jdbc.queryForMap("SELECT resource_id, kind, byte_length, sha256 FROM qwen_managed_session_resource"
                    + " WHERE session_id = ? ORDER BY resource_id LIMIT 1", s);
            ObjectNode params = WorkspaceRecoveryStore.JSON.createObjectNode().put("sessionId", s);
            params.set("ref", WorkspaceRecoveryStore.JSON.createObjectNode().put("resourceId", (String) row.get("resource_id"))
                    .put("kind", (String) row.get("kind")).put("schemaVersion", 1)
                    .put("byteLength", ((Number) row.get("byte_length")).longValue()).put("digest", (String) row.get("sha256")));
            try {
                store.call("resource", params);
                return "OK";
            } catch (RuntimeException error) {
                return "REFUSED:" + error.getMessage().replace(' ', '_');
            }
        }

        String state(String s) {
            var counts = jdbc.queryForMap("SELECT SUM(state = 'COLLECTED') AS collected, SUM(state = 'PUBLISHED') AS published,"
                    + " SUM(inline_bytes IS NOT NULL) AS bytes FROM qwen_managed_session_resource WHERE session_id = ?", s);
            var ledger = jdbc.queryForList("SELECT gc_blocker, collected_at IS NOT NULL AS done FROM"
                    + " qwen_managed_session_resource_collection WHERE session_id = ?", s);
            long livePins = jdbc.queryForObject("SELECT COUNT(*) FROM managed_workspace_recovery_session x"
                    + " JOIN managed_workspace_recovery_operation o ON o.operation_id = x.operation_id"
                    + " WHERE x.session_id = ? AND o.state IN ('CAPTURING', 'VERIFYING')", Long.class, s);
            return "rowsCollected=" + num(counts.get("collected")) + " rowsPublished=" + num(counts.get("published"))
                    + " rowsWithBytes=" + num(counts.get("bytes")) + " livePins=" + livePins
                    + " ledger=" + (ledger.isEmpty() ? "none" : "{blocker=" + ledger.getFirst().get("gc_blocker")
                    + ",done=" + flag(ledger.getFirst().get("done")) + "}");
        }

        static long num(Object value) {
            return value == null ? 0 : ((Number) value).longValue();
        }

        static String flag(Object value) {
            return value instanceof Boolean b ? b.toString() : String.valueOf(((Number) value).intValue() != 0);
        }

        @Override public void close() {
            try {
                admin.execute("DROP DATABASE " + schema);
            } catch (RuntimeException ignored) {
                // best effort
            }
        }
    }

    /** Wraps the registrar's JDBC: counts attempts, stamps S's pin insert, optionally holds the transaction open. */
    static final class Registrar {
        final JdbcTemplate template;
        final AtomicInteger attempts = new AtomicInteger();
        final AtomicLong pinnedAt = new AtomicLong();
        volatile WorkspaceRecoveryStore store;
        volatile String outcome = "not-run";

        Registrar(Rig rig, String s, CountDownLatch pinned, long holdMs) {
            var held = new AtomicBoolean();
            template = new JdbcTemplate(rig.source) {
                @Override public int update(String sql, Object... args) {
                    if (sql.startsWith("INSERT INTO managed_workspace_recovery_operation")) {
                        attempts.incrementAndGet();
                    }
                    int n = super.update(sql, args);
                    if (sql.startsWith("INSERT INTO managed_workspace_recovery_session") && args.length > 1 && s.equals(args[1])) {
                        pinnedAt.compareAndSet(0, System.nanoTime());
                        if (pinned != null) {
                            pinned.countDown();
                        }
                        if (holdMs > 0 && held.compareAndSet(false, true)) {
                            sleep(holdMs);
                        }
                    }
                    return n;
                }
            };
        }
    }
}
