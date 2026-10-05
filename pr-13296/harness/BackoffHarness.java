package com.alibaba.qwen.code.managedagent.store;

import com.alibaba.qwen.code.managedagent.config.ManagedAgentProperties;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.io.IOException;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Independent maintainer harness for PR #13296. Drives the real ToolPublicationCollector against a real
 * MySQL schema; fixtures go through the production retire()/quarantineResource()/read()/put() paths where
 * one exists. Counting is done in a JDBC proxy (client side) and in performance_schema (server side).
 */
public final class BackoffHarness {
    static final String TENANT = "tenant-pr13296";
    static final List<String> PROTECTED = List.of("legacy_write_evidence_missing", "quarantined",
            "not_accepted_complete", "recovery_protected");

    // ---- client-side statement counting -------------------------------------------------------------
    static final AtomicLong statements = new AtomicLong();
    static final AtomicLong tenantLocks = new AtomicLong();
    static final Map<String, AtomicLong> evaluationsBySession = new ConcurrentHashMap<>();
    static volatile boolean counting;
    static final ThreadLocal<Object[]> lastArgs = new ThreadLocal<>();

    static void count(String sql) {
        if (!counting) { return; }
        statements.incrementAndGet();
        if (sql.startsWith("SELECT tenant_id FROM qwen_tool_publication_tenant")) { tenantLocks.incrementAndGet(); }
    }

    static DataSource counted(DataSource source) {
        return (DataSource) Proxy.newProxyInstance(BackoffHarness.class.getClassLoader(),
                new Class<?>[] {DataSource.class}, (proxy, method, args) -> {
                    Object result = invoke(method, source, args);
                    if ("getConnection".equals(method.getName())) { return connection((Connection) result); }
                    return result;
                });
    }

    static Connection connection(Connection target) {
        return (Connection) Proxy.newProxyInstance(BackoffHarness.class.getClassLoader(),
                new Class<?>[] {Connection.class}, (proxy, method, args) -> {
                    Object result = invoke(method, target, args);
                    if ("prepareStatement".equals(method.getName())) {
                        String sql = (String) args[0];
                        return prepared((java.sql.PreparedStatement) result, sql);
                    }
                    if ("createStatement".equals(method.getName())) { return statement((Statement) result); }
                    return result;
                });
    }

    static java.sql.PreparedStatement prepared(java.sql.PreparedStatement target, String sql) {
        Map<Integer, Object> params = new HashMap<>();
        return (java.sql.PreparedStatement) Proxy.newProxyInstance(BackoffHarness.class.getClassLoader(),
                new Class<?>[] {java.sql.PreparedStatement.class}, (proxy, method, args) -> {
                    String name = method.getName();
                    if (name.startsWith("set") && args != null && args.length >= 2 && args[0] instanceof Integer index) {
                        params.put(index, args[1]);
                    }
                    if (name.equals("execute") || name.equals("executeQuery") || name.equals("executeUpdate")) {
                        if (args == null || args.length == 0) {
                            count(sql);
                            if (counting && sql.startsWith("SELECT retired_at, recovery_protected FROM qwen_output_session_retirement")) {
                                // candidate() reads the retention root once per evaluation; key it by session hash.
                                evaluationsBySession.computeIfAbsent(String.valueOf(params.get(2)), k -> new AtomicLong())
                                        .incrementAndGet();
                            }
                        }
                    }
                    return invoke(method, target, args);
                });
    }

    static Statement statement(Statement target) {
        return (Statement) Proxy.newProxyInstance(BackoffHarness.class.getClassLoader(),
                new Class<?>[] {Statement.class}, (proxy, method, args) -> {
                    String name = method.getName();
                    if ((name.equals("execute") || name.equals("executeQuery") || name.equals("executeUpdate"))
                            && args != null && args.length >= 1 && args[0] instanceof String sql) {
                        count(sql);
                    }
                    return invoke(method, target, args);
                });
    }

    static Object invoke(java.lang.reflect.Method method, Object target, Object[] args) throws Throwable {
        try { return method.invoke(target, args); }
        catch (InvocationTargetException error) { throw error.getCause(); }
    }

    // ---- filesystem object store (immutable keys, counts deletes) ------------------------------------
    static final class FileObjects implements ToolPublicationObjectStore {
        final Path root;
        final List<String> deleted = java.util.Collections.synchronizedList(new ArrayList<>());
        volatile boolean failPut;
        FileObjects(Path root) { this.root = root; }
        Path path(String key) { return root.resolve(key); }
        @Override public void putIfAbsent(String key, byte[] bytes) {
            try {
                Files.createDirectories(path(key).getParent());
                if (!Files.exists(path(key))) { Files.write(path(key), bytes); }
            } catch (IOException error) { throw new IllegalStateException(error); }
            if (failPut) { throw new IllegalStateException("PUT response lost"); }
        }
        @Override public java.io.InputStream open(String key) {
            try { return Files.newInputStream(path(key)); } catch (IOException error) { throw new IllegalStateException(error); }
        }
        @Override public void deleteIfPresent(String key) {
            if (org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()) {
                throw new AssertionError("delete inside a transaction");
            }
            try { Files.deleteIfExists(path(key)); } catch (IOException error) { throw new IllegalStateException(error); }
            deleted.add(key);
        }
        @Override public void requireUnversioned() {}
    }

    // ---- fixture --------------------------------------------------------------------------------------
    final String arm;
    final String scenario;
    final String database;
    final JdbcTemplate admin;
    final HikariDataSource pool;
    final JdbcTemplate jdbc;
    final DataSourceTransactionManager manager;
    final TransactionTemplate tx;
    final ToolPublicationRetentionStore retention;
    final FileObjects objects;
    final Map<String, String> groupOfSessionHash = new ConcurrentHashMap<>();
    final Map<String, List<String>> sessionsByGroup = new LinkedHashMap<>();
    final Map<String, String> scopeOfSession = new HashMap<>();
    final List<ToolPublicationRetentionStore.ReadLease> leases = new ArrayList<>();
    final StringBuilder out = new StringBuilder();

    BackoffHarness(String arm, String scenario) throws IOException {
        this.arm = arm;
        this.scenario = scenario;
        String base = System.getProperty("mysql.url", "jdbc:mysql://127.0.0.1:33296/");
        String password = System.getProperty("mysql.password", "pr13296");
        admin = new JdbcTemplate(new DriverManagerDataSource(base + "?allowPublicKeyRetrieval=true&useSSL=false", "root", password));
        database = "qwen_o4_h_" + scenario.toLowerCase() + "_" + arm + "_" + UUID.randomUUID().toString().substring(0, 8);
        admin.execute("CREATE DATABASE `" + database + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
        var config = new HikariConfig();
        config.setJdbcUrl(base + database + "?allowPublicKeyRetrieval=true&useSSL=false");
        config.setUsername("root");
        config.setPassword(password);
        config.setMaximumPoolSize(8);
        pool = new HikariDataSource(config);
        Flyway.configure().dataSource(pool).load().migrate();
        DataSource source = counted(pool);
        jdbc = new JdbcTemplate(source);
        manager = new DataSourceTransactionManager(source);
        tx = new TransactionTemplate(manager);
        retention = new ToolPublicationRetentionStore(jdbc, manager);
        Path root = Path.of(System.getProperty("objects.root", "/tmp/pr13296-objects"), database);
        Files.createDirectories(root);
        objects = new FileObjects(root);
    }

    void log(String line) {
        System.out.println(line);
        out.append(line).append('\n');
    }

    long now() { return ToolPublicationRetentionStore.now(jdbc); }

    /** One session's publications; each has one VERIFIED physical object with a real file. */
    String seedSession(String group, String session, int publications, boolean writeEvidence, boolean acceptedComplete) {
        String scope = ToolPublicationRetentionStore.hash(TENANT + session);
        scopeOfSession.put(session, scope);
        groupOfSessionHash.put(ToolPublicationRetentionStore.hash(session), group);
        sessionsByGroup.computeIfAbsent(group, k -> new ArrayList<>()).add(session);
        for (int index = 0; index < publications; index++) {
            String publication = group + "-" + session + "-" + index;
            // Legacy rows are written without write_evidence, so they take the V30 column default (FALSE).
            String evidenceColumns = writeEvidence ? ", write_evidence" : "";
            String evidenceValues = writeEvidence ? ", TRUE" : "";
            jdbc.update("INSERT INTO qwen_tool_publication (scope_key, tenant_key, tenant_id, workspace_id, session_id,"
                            + " publication_id, execution_key, capture_id, binding_json, binding_digest, token_hash, state,"
                            + " capture_bytes, producer_bytes, admission_bytes, producer_phase, accepted_complete,"
                            + " capture_held_bytes, producer_held_bytes, admission_held_bytes, capture_used_bytes" + evidenceColumns + ")"
                            + " VALUES (?, ?, ?, 'workspace-1', ?, ?, ?, ?, '{}', ?, ?, 'FENCED', 1000, 1000, 1000,"
                            + " 'REFERENCED', ?, 1000, 1000, 1000, 123" + evidenceValues + ")",
                    scope, ToolPublicationRetentionStore.hash(TENANT), TENANT, session, publication,
                    ToolPublicationRetentionStore.hash(scope + publication), "capture-" + publication,
                    scope, scope, acceptedComplete);
            String key = "objects/" + session + "/" + publication;
            byte[] bytes = (publication + ":payload").repeat(8).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            objects.putIfAbsent(key, bytes);
            jdbc.update("INSERT INTO qwen_tool_publication_object (scope_key, publication_id, slot_key, resource_id,"
                            + " resource_kind, byte_length, sha256, object_key, state, operation_id, created_at)"
                            + " VALUES (?, ?, 'content', ?, 'managed-tool-result-content', ?, ?, ?, 'VERIFIED', 'op', CURRENT_TIMESTAMP(6))",
                    scope, publication, publication, bytes.length, ToolPublicationContract.sha256(bytes), key);
        }
        return scope;
    }

    void retire(String session) {
        tx.executeWithoutResult(status -> {
            ToolPublicationRetentionStore.lockDeletion(jdbc, TENANT, session);
            ToolPublicationRetentionStore.retire(jdbc, TENANT, session, "delete-" + session);
        });
    }

    /** Seeds and retires one group of sessions through the production paths for its protection. */
    void seedGroup(String group, int sessions, int perSession) {
        for (int s = 0; s < sessions; s++) {
            String session = group + "-s" + s;
            boolean legacy = group.equals("legacy_write_evidence_missing");
            boolean incomplete = group.equals("not_accepted_complete");
            String scope = seedSession(group, session, perSession, !legacy, !incomplete);
            switch (group) {
                case "quarantined" -> {
                    for (int i = 0; i < perSession; i++) {
                        String publication = group + "-" + session + "-" + i;
                        retention.quarantineResource(scope, publication, "objects/" + session + "/" + publication);
                    }
                }
                case "recovery_protected" -> jdbc.update("INSERT INTO qwen_managed_session_journal_head (tenant_id,"
                        + " workspace_id, session_id, storage_version, state, writer_generation, journal_revision,"
                        + " committed_sequence, activation_epoch, compacted_through_revision, recovery_status,"
                        + " recovery_detail_code, created_at, updated_at) VALUES (?, 'workspace-1', ?, 1, 'ARCHIVED', 0,"
                        + " 0, 0, 0, 0, 'BLOCKED_RESOURCE', 'resource_digest_mismatch', CURRENT_TIMESTAMP(6),"
                        + " CURRENT_TIMESTAMP(6))", TENANT, session);
                case "reader_active" -> leases.add(retention.read(TENANT, session));
                case "put_unresolved" -> {
                    String publication = group + "-" + session + "-0";
                    objects.failPut = true;
                    try {
                        retention.put(new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode()
                                .put("tenantId", TENANT).put("sessionId", session), scope, publication,
                                "objects/" + session + "/" + publication, new byte[] {1}, objects);
                    } catch (IllegalStateException expected) {
                        // UNKNOWN attempt: the response was lost after the bytes landed.
                    } finally { objects.failPut = false; }
                }
                default -> { }
            }
            retire(session);
        }
    }

    ToolPublicationCollector collector(Duration grace) {
        var props = new ManagedAgentProperties();
        props.getToolPublication().setGcEnabled(true);
        props.getToolPublication().setDeletionGrace(grace);
        return new ToolPublicationCollector(jdbc, manager, retention, objects, props);
    }

    // ---- measurement helpers --------------------------------------------------------------------------
    record Snapshot(long statements, long tenantLocks, Map<String, Long> evaluations, long serverStatements,
            long serverLockMicros, long serverRowsExamined, long wallNanos) {}

    Snapshot snap() {
        Map<String, Long> evals = new HashMap<>();
        evaluationsBySession.forEach((sessionHash, n) -> evals.merge(groupOfSessionHash.getOrDefault(sessionHash, "?"), n.get(), Long::sum));
        var server = admin.queryForMap("SELECT COALESCE(SUM(COUNT_STAR),0) AS n, COALESCE(SUM(SUM_LOCK_TIME),0) AS lock_ps,"
                + " COALESCE(SUM(SUM_ROWS_EXAMINED),0) AS rows_examined FROM performance_schema.events_statements_summary_by_digest"
                + " WHERE SCHEMA_NAME = ?", database);
        return new Snapshot(statements.get(), tenantLocks.get(), evals, ((Number) server.get("n")).longValue(),
                ((Number) server.get("lock_ps")).longValue() / 1_000_000, ((Number) server.get("rows_examined")).longValue(),
                System.nanoTime());
    }

    String delta(Snapshot a, Snapshot b) {
        Map<String, Long> evals = new LinkedHashMap<>();
        for (String group : sessionsByGroup.keySet()) {
            long d = b.evaluations().getOrDefault(group, 0L) - a.evaluations().getOrDefault(group, 0L);
            if (d != 0) { evals.put(group, d); }
        }
        long protectedEvals = PROTECTED.stream().mapToLong(g -> evals.getOrDefault(g, 0L)).sum();
        return String.format("wall=%.1fs client_sql=%d tenant_locks=%d server_sql=%d server_lock_us=%d rows_examined=%d"
                        + " protected_evaluations=%d evaluations=%s",
                (b.wallNanos() - a.wallNanos()) / 1e9, b.statements() - a.statements(), b.tenantLocks() - a.tenantLocks(),
                b.serverStatements() - a.serverStatements(), b.serverLockMicros() - a.serverLockMicros(),
                b.serverRowsExamined() - a.serverRowsExamined(), protectedEvals, evals);
    }

    /** Per group: state / blocker / count / next-attempt offset from DB now / bytes still held. */
    void table(String title) {
        long now = now();
        log("  [" + title + "] group | retention_state | gc_blocker | n | gc_next_at-now (min..max) | held+used | files on disk");
        for (var entry : sessionsByGroup.entrySet()) {
            String group = entry.getKey();
            var rows = admin.queryForList("SELECT retention_state, gc_blocker, COUNT(*) AS n, MIN(gc_next_at) AS lo,"
                    + " MAX(gc_next_at) AS hi, SUM(capture_held_bytes + producer_held_bytes + admission_held_bytes) AS held,"
                    + " SUM(capture_used_bytes) AS used FROM `" + database + "`.qwen_tool_publication WHERE publication_id LIKE ?"
                    + " GROUP BY retention_state, gc_blocker ORDER BY retention_state, gc_blocker", group + "-%");
            long files = entry.getValue().stream().mapToLong(session -> {
                Path dir = objects.root.resolve("objects").resolve(session);
                if (!Files.isDirectory(dir)) { return 0; }
                try (var list = Files.list(dir)) { return list.count(); } catch (IOException error) { throw new IllegalStateException(error); }
            }).sum();
            for (var row : rows) {
                long lo = ((Number) row.get("lo")).longValue();
                long hi = ((Number) row.get("hi")).longValue();
                log(String.format("    %-30s | %-10s | %-22s | %5d | %s..%s | %d+%d | %d", group, row.get("retention_state"),
                        row.get("gc_blocker"), ((Number) row.get("n")).longValue(), offset(lo, now), offset(hi, now),
                        ((Number) row.get("held")).longValue(), ((Number) row.get("used")).longValue(), files));
            }
        }
    }

    static String offset(long at, long now) {
        if (at == 0) { return "0"; }
        long seconds = Math.round((at - now) / 1000.0);
        return seconds >= 3600 || seconds <= -3600 ? String.format("%+.2fh", seconds / 3600.0) : String.format("%+ds", seconds);
    }

    long collected(String group) {
        return admin.queryForObject("SELECT COUNT(*) FROM `" + database + "`.qwen_tool_publication WHERE publication_id LIKE ?"
                + " AND retention_state = 'COLLECTED'", Long.class, group + "-%");
    }

    long total(String group) {
        return admin.queryForObject("SELECT COUNT(*) FROM `" + database + "`.qwen_tool_publication WHERE publication_id LIKE ?",
                Long.class, group + "-%");
    }

    /** Production cadence: @Scheduled(fixedDelay = 1000) means run, then wait one second. */
    int cadence(ToolPublicationCollector gc, long maxMillis, java.util.function.BooleanSupplier done) throws InterruptedException {
        long deadline = System.currentTimeMillis() + maxMillis;
        int ticks = 0;
        while (System.currentTimeMillis() < deadline && !done.getAsBoolean()) {
            gc.tick();
            ticks++;
            if (!done.getAsBoolean()) { Thread.sleep(1000); }
        }
        return ticks;
    }

    void close() {
        for (var lease : leases) { try { lease.close(); } catch (RuntimeException ignored) { } }
        pool.close();
        if (!Boolean.getBoolean("keep.database")) { admin.execute("DROP DATABASE `" + database + "`"); }
        try (var walk = Files.walk(objects.root)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        } catch (IOException ignored) { }
    }

    // ---- scenarios ------------------------------------------------------------------------------------
    /** A: 3,000 protected + controls, zero grace, real 61 s wait, steady-state latency under real cadence. */
    void scenarioA() throws Exception {
        int sessions = Integer.getInteger("a.sessions", 30);
        int perSession = Integer.getInteger("a.perSession", 25);
        for (String group : PROTECTED) { seedGroup(group, sessions, perSession); }
        seedGroup("reader_active", 2, 10);
        seedGroup("put_unresolved", 2, 1);
        seedGroup("healthy", 4, 5);
        log("seeded: protected=" + PROTECTED.size() * sessions * perSession + " reader_active=20 put_unresolved=2 healthy=20"
                + " (one tenant, " + (PROTECTED.size() * sessions + 8) + " sessions; protections via production paths:"
                + " legacy=V30 default, quarantine=quarantineResource(), recovery=retire() over BLOCKED_RESOURCE head,"
                + " reader=read() lease, put=put() with lost response, incomplete=accepted_complete FALSE)");
        var gc = collector(Duration.ZERO);
        counting = true;

        var s0 = snap();
        int ticks = cadence(gc, 300_000, () -> collected("healthy") == 20 && everyRowExamined());
        var s1 = snap();
        log("P1 first sweep, production cadence: ticks=" + ticks + " " + delta(s0, s1));
        log("   healthy collected=" + collected("healthy") + "/20, deleted keys=" + objects.deleted.size());
        table("after first sweep");

        for (var lease : leases) { lease.close(); }
        leases.clear();
        log("P2 reader leases closed; real wall-clock wait 61 s ...");
        Thread.sleep(61_000);

        var s2 = snap();
        for (int call = 0; call < 100; call++) { gc.runOnce(); }
        var s3 = snap();
        log("P3 second sweep, 100 back-to-back runOnce() calls after 61 s: " + delta(s2, s3));
        log("   reader_active collected after lease close=" + collected("reader_active") + "/20");
        table("after second sweep");

        // Steady state: production cadence for 100 s, then a healthy publication whose grace deadline is now.
        var s4 = snap();
        cadence(gc, 100_000, () -> false);
        var s5 = snap();
        double minutes = (s5.wallNanos() - s4.wallNanos()) / 6e10;
        log(String.format("P4 steady state %.0f s of production cadence: %s; client_sql/min=%.0f server_sql/min=%.0f",
                minutes * 60, delta(s4, s5), (s5.statements() - s4.statements()) / minutes,
                (s5.serverStatements() - s4.serverStatements()) / minutes));
        seedGroup("late_healthy", 1, 5);
        jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = ?, gc_blocker = 'grace_period' WHERE publication_id LIKE 'late_healthy-%'", now());
        long start = System.nanoTime();
        int lateTicks = cadence(gc, 240_000, () -> collected("late_healthy") == 5);
        log(String.format("P4 latency: healthy publication due now (grace deadline reached) collected after %d ticks / %.1f s"
                + " (5/5=%s)", lateTicks, (System.nanoTime() - start) / 1e9, collected("late_healthy") == 5));

        // One day later: shift every protected deadline back by exactly 24 h, preserving the first-sweep spread.
        long shift = Duration.ofHours(24).toMillis();
        int moved = jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = gc_next_at - ? WHERE retention_state = 'RETIRING'"
                + " AND gc_next_at > ?", shift, now() + Duration.ofHours(1).toMillis());
        log("P5 day boundary: shifted " + moved + " deferred rows by -24h (spread preserved)");
        seedGroup("day_healthy", 1, 5);
        // Parked until tick 20 so it cannot be collected before its (simulated) grace deadline.
        jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = ?, gc_blocker = 'grace_period'"
                + " WHERE publication_id LIKE 'day_healthy-%'", now() + Duration.ofHours(10).toMillis());
        var s6 = snap();
        int dayTicks = 0;
        long dueAt = 0;
        long collectedAt = 0;
        long dayStart = System.nanoTime();
        while (dayTicks < 400) {
            if (dayTicks == 20) {
                dueAt = System.nanoTime();
                jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = ?, gc_blocker = 'grace_period'"
                        + " WHERE publication_id LIKE 'day_healthy-%'", now());
            }
            gc.tick();
            dayTicks++;
            if (dueAt != 0 && collectedAt == 0 && collected("day_healthy") == 5) { collectedAt = System.nanoTime(); }
            long overdue = admin.queryForObject("SELECT COUNT(*) FROM `" + database + "`.qwen_tool_publication"
                    + " WHERE retention_state = 'RETIRING' AND gc_next_at <= ?", Long.class, now());
            if (collectedAt != 0 && (overdue == 0 || dayTicks >= 150)) { break; }
            Thread.sleep(1000);
        }
        var s7 = snap();
        log(String.format("P5 re-sweep under production cadence: ticks=%d wall=%.0fs %s", dayTicks,
                (System.nanoTime() - dayStart) / 1e9, delta(s6, s7)));
        log(String.format("P5 latency: healthy publication due mid-burst (tick 20) collected after %.1f s",
                collectedAt == 0 ? -1 : (collectedAt - dueAt) / 1e9));
        table("after day boundary");
        integrity();
    }

    boolean everyRowExamined() {
        return admin.queryForObject("SELECT COUNT(*) FROM `" + database + "`.qwen_tool_publication WHERE retention_state = 'RETIRING'"
                + " AND gc_blocker IS NULL", Long.class) == 0;
    }

    /** Protected bytes, quota and files must be untouched; only collected publications lost files. */
    void integrity() {
        for (String group : PROTECTED) {
            long rows = total(group);
            var row = admin.queryForMap("SELECT COUNT(*) AS n, SUM(retention_state = 'RETIRING') AS retiring,"
                    + " SUM(capture_held_bytes + producer_held_bytes + admission_held_bytes) AS held, SUM(capture_used_bytes) AS used"
                    + " FROM `" + database + "`.qwen_tool_publication WHERE publication_id LIKE ?", group + "-%");
            long files = sessionsByGroup.get(group).stream().mapToLong(session -> {
                try (var list = Files.list(objects.root.resolve("objects").resolve(session))) { return list.count(); }
                catch (IOException error) { return -1; }
            }).sum();
            long objectsVerified = admin.queryForObject("SELECT COUNT(*) FROM `" + database + "`.qwen_tool_publication_object"
                    + " WHERE publication_id LIKE ? AND state IN ('VERIFIED', 'QUARANTINED')", Long.class, group + "-%");
            log(String.format("  integrity %-30s rows=%d retiring=%s held=%s used=%s files=%d catalog_live=%d", group, rows,
                    row.get("retiring"), row.get("held"), row.get("used"), files, objectsVerified));
        }
        long protectedDeleted = objects.deleted.stream().filter(k -> PROTECTED.stream().anyMatch(g -> k.contains("/" + g + "-"))).count();
        log("  deleted keys total=" + objects.deleted.size() + " of which protected=" + protectedDeleted);
    }

    /** B: shipped 24 h deletion grace combined with the 24 h protected backoff. */
    void scenarioB() throws Exception {
        for (String group : PROTECTED) { seedGroup(group, 1, 5); }
        seedGroup("healthy", 1, 5);
        var gc = collector(Duration.ofHours(24));
        counting = true;
        for (int i = 0; i < 4; i++) { gc.runOnce(); }
        long retiredAt = admin.queryForObject("SELECT MIN(retired_at) FROM `" + database + "`.qwen_output_session_retirement", Long.class);
        log("B1 first pass with grace=24h (retired " + offset(retiredAt, now()) + " ago):");
        table("grace running");
        log("   rows whose deadline is earlier than retired_at+grace: " + admin.queryForObject("SELECT COUNT(*) FROM `"
                + database + "`.qwen_tool_publication p JOIN `" + database + "`.qwen_output_session_retirement r"
                + " ON r.tenant_id = p.tenant_id AND r.session_id = p.session_id WHERE p.retention_state = 'RETIRING'"
                + " AND p.gc_next_at < r.retired_at + 86400000", Long.class));
        // Grace elapses: move retirement and every stored deadline back by 24 h + 1 min (time travel, spread kept).
        long back = Duration.ofHours(24).plusMinutes(1).toMillis();
        jdbc.update("UPDATE qwen_output_session_retirement SET retired_at = retired_at - ?", back);
        jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = gc_next_at - ? WHERE retention_state = 'RETIRING'", back);
        for (int i = 0; i < 8; i++) { gc.runOnce(); }
        log("B2 after grace elapsed (retired_at and deadlines moved back 24h+1m):");
        table("grace elapsed");
        integrity();
    }

    /** C: two collector instances (two owners) on one backlog under production cadence. */
    void scenarioC() throws Exception {
        for (String group : PROTECTED) { seedGroup(group, 6, 25); }
        seedGroup("healthy", 2, 5);
        var a = collector(Duration.ZERO);
        var b = collector(Duration.ZERO);
        counting = true;
        long deadlocksBefore = deadlocks();
        var s0 = snap();
        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        long until = System.currentTimeMillis() + Long.getLong("c.millis", 150_000);
        for (var gc : List.of(a, b)) {
            pool.submit(() -> {
                while (System.currentTimeMillis() < until) {
                    gc.tick();
                    try { Thread.sleep(1000); } catch (InterruptedException error) { return; }
                }
            });
        }
        pool.shutdown();
        pool.awaitTermination(10, java.util.concurrent.TimeUnit.MINUTES);
        var s1 = snap();
        log("C two instances, production cadence, " + Long.getLong("c.millis", 150_000) / 1000 + " s: " + delta(s0, s1));
        log("   healthy collected=" + collected("healthy") + "/10; ER_LOCK_DEADLOCK delta=" + (deadlocks() - deadlocksBefore));
        table("two instances");
        integrity();
    }

    /**
     * D: the next-day re-sweep. D1 keeps the first-sweep spacing and makes the earliest row due now (what a
     * collector running continuously sees); D2 makes every row overdue at once (what it sees after GC was
     * paused or all instances were down past the due window). A healthy publication becomes due at tick 20.
     */
    void scenarioD() throws Exception {
        int sessions = Integer.getInteger("a.sessions", 30);
        int perSession = Integer.getInteger("a.perSession", 25);
        for (String group : PROTECTED) { seedGroup(group, sessions, perSession); }
        seedGroup("healthy", 4, 5);
        var gc = collector(Duration.ZERO);
        counting = true;
        int ticks = cadence(gc, 300_000, () -> collected("healthy") == 20 && everyRowExamined());
        log("D0 first sweep under production cadence: ticks=" + ticks);
        long day = Duration.ofHours(24).toMillis();
        for (String variant : List.of("D1_natural", "D2_clumped")) {
            long lo = admin.queryForObject("SELECT MIN(gc_next_at) FROM `" + database + "`.qwen_tool_publication"
                    + " WHERE retention_state = 'RETIRING' AND gc_next_at > ?", Long.class, now() + day / 2);
            long hi = admin.queryForObject("SELECT MAX(gc_next_at) FROM `" + database + "`.qwen_tool_publication"
                    + " WHERE retention_state = 'RETIRING' AND gc_next_at > ?", Long.class, now() + day / 2);
            long shift = variant.startsWith("D1") ? lo - now() : hi - now() + 60_000;
            jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = gc_next_at - ? WHERE retention_state = 'RETIRING'"
                    + " AND gc_next_at > ?", shift, now() + day / 2);
            String group = variant.toLowerCase() + "_healthy";
            seedGroup(group, 1, 5);
            jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = ? WHERE publication_id LIKE ?",
                    now() + Duration.ofHours(10).toMillis(), group + "-%");
            log(variant + ": deferred rows now due between " + offset(lo - shift, now()) + " and " + offset(hi - shift, now()));
            var before = snap();
            long dueAt = 0;
            long doneAt = 0;
            int tick = 0;
            int maxOverdue = 0;
            StringBuilder queue = new StringBuilder();
            while (tick < 200) {
                if (tick == 20) {
                    dueAt = System.nanoTime();
                    jdbc.update("UPDATE qwen_tool_publication SET gc_next_at = ?, gc_blocker = 'grace_period'"
                            + " WHERE publication_id LIKE ?", now(), group + "-%");
                }
                int overdue = admin.queryForObject("SELECT COUNT(*) FROM `" + database + "`.qwen_tool_publication"
                        + " WHERE retention_state = 'RETIRING' AND gc_next_at <= ?", Integer.class, now());
                maxOverdue = Math.max(maxOverdue, overdue);
                if (tick % 10 == 0) { queue.append(tick).append(':').append(overdue).append(' '); }
                gc.tick();
                tick++;
                if (dueAt != 0 && doneAt == 0 && collected(group) == 5) { doneAt = System.nanoTime(); }
                if (doneAt != 0 && admin.queryForObject("SELECT COUNT(*) FROM `" + database + "`.qwen_tool_publication"
                        + " WHERE retention_state = 'RETIRING' AND gc_next_at <= ?", Integer.class, now() + 5_000) == 0) {
                    break;
                }
                Thread.sleep(1000);
            }
            log(String.format("%s: ticks=%d %s", variant, tick, delta(before, snap())));
            log(String.format("%s: due rows waiting before each tick (tick:count) %s| max=%d", variant, queue, maxOverdue));
            log(String.format("%s: healthy publication due at tick 20 collected after %.1f s", variant, (doneAt - dueAt) / 1e9));
        }
        table("after day boundaries");
        integrity();
    }

    long deadlocks() {
        return admin.queryForObject("SELECT SUM_ERROR_RAISED FROM performance_schema.events_errors_summary_global_by_error"
                + " WHERE ERROR_NAME = 'ER_LOCK_DEADLOCK'", Long.class);
    }

    public static void main(String[] args) throws Exception {
        String arm = args[0];
        String scenario = args[1];
        var harness = new BackoffHarness(arm, scenario);
        harness.log("=== PR #13296 harness arm=" + arm + " scenario=" + scenario + " db=" + harness.database + " mysql="
                + harness.admin.queryForObject("SELECT VERSION()", String.class) + " isolation="
                + harness.admin.queryForObject("SELECT @@transaction_isolation", String.class) + " flyway="
                + harness.admin.queryForObject("SELECT MAX(CAST(version AS UNSIGNED)) FROM `" + harness.database
                + "`.flyway_schema_history", String.class));
        try {
            switch (scenario) {
                case "A" -> harness.scenarioA();
                case "B" -> harness.scenarioB();
                case "C" -> harness.scenarioC();
                case "D" -> harness.scenarioD();
                default -> throw new IllegalArgumentException(scenario);
            }
        } finally {
            harness.close();
        }
        Files.writeString(Path.of(System.getProperty("out.dir", "."), "harness-" + scenario + "-" + arm + ".txt"), harness.out);
    }
}
