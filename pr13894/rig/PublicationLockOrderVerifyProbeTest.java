package com.alibaba.qwen.code.managedagent;

import static com.alibaba.qwen.code.managedagent.PublicationJournalFixture.COMMIT_MARKER;
import static com.alibaba.qwen.code.managedagent.PublicationJournalFixture.PUBLICATION_TOKEN;
import static com.alibaba.qwen.code.managedagent.PublicationJournalFixture.WRITER_TOKEN;
import static com.alibaba.qwen.code.managedagent.PublicationJournalFixture.digest;

import com.alibaba.qwen.code.managedagent.store.ManagedSessionStoreModels.AuthorizeLifecycleRequest;
import com.alibaba.qwen.code.managedagent.store.ManagedSessionStoreModels.CommitResource;
import com.alibaba.qwen.code.managedagent.store.ManagedSessionStoreModels.CommitTransactionRequest;
import com.alibaba.qwen.code.managedagent.store.ToolPublicationAdmissionStore;
import com.alibaba.qwen.code.managedagent.store.ToolPublicationDataStore;
import com.alibaba.qwen.code.managedagent.store.ToolPublicationObjectStore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PR #13894 maintainer verification probe (not part of the PR).
 *
 * <p>Drives the production publication/admission/session stores against a real MySQL
 * database. A same-tenant placement owner (ManagedSessionStore.authorizeOrdinary, run in a
 * transaction as its @Transactional proxy would) is paused right after it acquires the tenant
 * placement guard; the subject operation then runs; the owner is released once the subject is
 * observed waiting in InnoDB (or has finished). Identical bytes run on base and head.
 */
class PublicationLockOrderVerifyProbeTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void matrix() throws Exception {
        String url = System.getProperty("mysql.url");
        String user = System.getProperty("mysql.user");
        String password = System.getProperty("mysql.password", "");
        String arm = System.getProperty("probe.arm", "unknown");
        Path out = Path.of(System.getProperty("probe.out"));
        int reps = Integer.getInteger("probe.reps", 3);
        int stressSeconds = Integer.getInteger("probe.stressSeconds", 20);
        List<String> scenarios = List.of(System.getProperty("probe.scenarios",
                "commit-ambient,prepare-commit-ambient,prepare-ambient,commit-standalone,"
                        + "prepare-standalone,apply-renew-standalone,apply-renew-ambient,"
                        + "stress-replay-ambient,stress-replay-standalone").split(","));
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        for (String scenario : scenarios) {
            int count = scenario.startsWith("stress") ? 1 : reps;
            for (int rep = 1; rep <= count; rep++) {
                ObjectNode result = JSON.createObjectNode().put("arm", arm).put("scenario", scenario)
                        .put("rep", rep);
                String schema = "p13894_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                admin.execute("CREATE DATABASE " + schema);
                try {
                    var source = new HookedDataSource(new DriverManagerDataSource(
                            url.replaceFirst("/[^/?]+(?=\\?|$)", "/" + schema), user, password));
                    if (scenario.startsWith("stress")) {
                        stress(scenario, source, admin, schema, stressSeconds, result);
                    } else {
                        scheduled(scenario, source, admin, schema, result);
                    }
                } catch (Throwable error) {
                    result.put("probeError", describe(error));
                } finally {
                    admin.execute("DROP DATABASE " + schema);
                }
                Files.writeString(out, result.toString() + "\n", StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                System.out.println("PROBE " + result);
            }
        }
    }

    private record Fixture(PublicationJournalFixture journal, ToolPublicationDataStore data,
            ToolPublicationAdmissionStore admissions, JsonNode key, JsonNode outcome) {
    }

    private record Receipt(JsonNode root, CommitTransactionRequest request) {
    }

    private static Fixture fixture(HookedDataSource source) {
        Flyway.configure().dataSource(source).load().migrate();
        var journal = PublicationJournalFixture.create(source, false);
        journal.reserve();
        Map<String, byte[]> objects = new ConcurrentHashMap<>();
        ToolPublicationObjectStore bucket = new ToolPublicationObjectStore() {
            @Override
            public void putIfAbsent(String key, byte[] bytes) {
                objects.putIfAbsent(key, bytes.clone());
            }

            @Override
            public InputStream open(String key) {
                return new ByteArrayInputStream(objects.get(key));
            }

            @Override
            public void requireUnversioned() {
            }
        };
        var data = new ToolPublicationDataStore(journal.jdbc, journal.manager, journal.store, journal.sessions,
                bucket, Duration.ofMinutes(2), Duration.ofSeconds(30),
                new ToolPublicationDataStore.VerificationBudget(16 * 1024 * 1024, Duration.ofMinutes(25)));
        var admissions = new ToolPublicationAdmissionStore(journal.jdbc, journal.manager, journal.sessions, data);
        var key = journal.binding.get("sessionKey");
        var envelope = JSON.createObjectNode().put("executionStatus", "error");
        envelope.putArray("responseParts");
        envelope.set("capture", JSON.createObjectNode().put("captureStatus", "unavailable")
                .put("captureReason", "storage_failed").put("previewTruncated", false)
                .put("deliveryStatus", "pending").putNull("manifest"));
        var outcome = JSON.createObjectNode().put("schemaVersion", 1).put("decision", "blocked")
                .putNull("manifestRef");
        outcome.set("envelope", envelope);
        var history = JSON.createObjectNode().put("messageId", "11111111-1111-4111-8111-111111111111")
                .put("timestamp", "2026-10-11T00:00:00Z").put("model", "probe");
        history.putArray("parts").addObject().put("text", "Shell capture unavailable");
        outcome.set("history", history);
        return new Fixture(journal, data, admissions, key, outcome);
    }

    private static void finish(Fixture f) {
        f.data().finish(f.key(), "pub-1", PUBLICATION_TOKEN, "finish",
                f.outcome().path("envelope").toString().getBytes(StandardCharsets.UTF_8));
    }

    private static JsonNode prepare(Fixture f) {
        return f.data().prepareAdmission(f.key(), "pub-1", "writer-1", 1, WRITER_TOKEN, f.outcome());
    }

    private static Receipt receipt(Fixture f, JsonNode root) {
        var journal = f.journal();
        long sequence = journal.sequence + 1;
        var payload = JSON.createObjectNode().put("executionCallId", "execution-1")
                .put("historyRevision", sequence).putNull("resultRef");
        payload.set("toolOutcomeRef", root);
        payload.putArray("resources");
        String records = journal.event(sequence, "tool.receipt", payload) + COMMIT_MARKER;
        var request = new CommitTransactionRequest("workspace-1", "writer-1", 1, journal.revision,
                journal.sequence, "receipt", "recordToolResult", "execution-1", root.path("digest").asText(),
                sequence, sequence, 1, digest(records), journal.commitDigest, digest(records), 1, null, 2,
                Base64.getEncoder().encodeToString(records.getBytes(StandardCharsets.UTF_8)), digest(records),
                List.of(new CommitResource(root.path("resourceId").asText(), "managed-tool-outcome", 1,
                        root.path("byteLength").asLong(), root.path("digest").asText(), null)));
        return new Receipt(root, request);
    }

    /** The resource id and digest are pure functions of scope, publication and outcome bytes. */
    private static JsonNode expectedRoot(Fixture f) {
        byte[] bytes = f.outcome().toString().getBytes(StandardCharsets.UTF_8);
        String scope = sha(JSON.createArrayNode().add("tenant-1").add("workspace-1").add("session-1").toString());
        return JSON.createObjectNode()
                .put("resourceId", "result-" + sha(scope + ":pub-1:admission").substring(0, 32))
                .put("kind", "managed-tool-outcome").put("schemaVersion", 1)
                .put("byteLength", bytes.length).put("digest", sha(bytes));
    }

    private static String sha(String value) {
        return sha(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String sha(byte[] value) {
        try {
            return java.util.HexFormat.of().formatHex(
                    java.security.MessageDigest.getInstance("SHA-256").digest(value));
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static void authorizeOrdinary(Fixture f) {
        new TransactionTemplate(f.journal().manager).executeWithoutResult(status ->
                f.journal().sessions.authorizeOrdinary("tenant-1", "session-1", WRITER_TOKEN,
                        new AuthorizeLifecycleRequest("workspace-1", "writer-1", 1)));
    }

    private void scheduled(String scenario, HookedDataSource source, JdbcTemplate admin, String schema,
            ObjectNode result) throws Exception {
        Fixture f = fixture(source);
        Receipt prepared = null;
        if (!scenario.startsWith("apply")) {
            finish(f);
        }
        if (scenario.startsWith("commit")) {
            prepared = receipt(f, prepare(f));
        }
        Receipt contestedReceipt = scenario.startsWith("prepare-commit") ? receipt(f, expectedRoot(f)) : prepared;
        final Receipt receipt = contestedReceipt;
        Runnable subject = switch (scenario) {
            case "commit-ambient" -> () -> new TransactionTemplate(f.journal().manager).execute(status ->
                    f.admissions().commitReceipt(f.key(), "pub-1", WRITER_TOKEN, receipt.request()));
            case "commit-standalone" -> () -> f.admissions().commitReceipt(f.key(), "pub-1", WRITER_TOKEN,
                    receipt.request());
            case "prepare-commit-ambient" -> () -> new TransactionTemplate(f.journal().manager).execute(status -> {
                JsonNode root = prepare(f);
                if (!root.equals(receipt.root())) {
                    throw new AssertionError("Unexpected admission root " + root);
                }
                return f.admissions().commitReceipt(f.key(), "pub-1", WRITER_TOKEN, receipt.request());
            });
            case "prepare-ambient" -> () -> new TransactionTemplate(f.journal().manager).execute(status -> prepare(f));
            case "prepare-standalone" -> () -> prepare(f);
            case "apply-renew-standalone" -> () -> f.journal().store.apply(f.journal().request("renew"),
                    WRITER_TOKEN, PUBLICATION_TOKEN);
            case "apply-renew-ambient" -> () -> new TransactionTemplate(f.journal().manager).execute(status ->
                    f.journal().store.apply(f.journal().request("renew"), WRITER_TOKEN, PUBLICATION_TOKEN));
            default -> throw new IllegalArgumentException(scenario);
        };
        long deadlocksBefore = deadlocks(admin);
        source.timeline.clear();
        source.start = System.nanoTime();
        source.holdOwner = true;
        var ownerError = new AtomicReference<Throwable>();
        var subjectError = new AtomicReference<Throwable>();
        var subjectDone = new CountDownLatch(1);
        var ownerDone = new CountDownLatch(1);
        Thread owner = new Thread(() -> {
            try {
                authorizeOrdinary(f);
            } catch (Throwable error) {
                ownerError.set(error);
            } finally {
                ownerDone.countDown();
            }
        }, "owner");
        owner.start();
        if (!source.ownerHoldsPlacement.await(30, TimeUnit.SECONDS)) {
            throw new AssertionError("Owner never acquired placement");
        }
        long subjectStart = System.nanoTime();
        long[] subjectEnd = {0};
        Thread subjectThread = new Thread(() -> {
            try {
                subject.run();
            } catch (Throwable error) {
                subjectError.set(error);
            } finally {
                subjectEnd[0] = System.nanoTime();
                subjectDone.countDown();
            }
        }, "subject");
        subjectThread.start();
        // Wait until the subject finishes or InnoDB reports it waiting; poll no faster than 200 ms.
        ArrayNode waits = JSON.createArrayNode();
        boolean waitingAtRelease = false;
        long pollUntil = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        int consecutiveWaits = 0;
        while (System.nanoTime() < pollUntil) {
            if (subjectDone.await(200, TimeUnit.MILLISECONDS)) {
                break;
            }
            var lockWaits = lockWaits(admin, schema);
            if (!lockWaits.isEmpty()) {
                consecutiveWaits++;
                if (consecutiveWaits >= 2) {
                    waitingAtRelease = true;
                    for (var wait : lockWaits) {
                        waits.add(JSON.valueToTree(wait));
                    }
                    break;
                }
            } else {
                consecutiveWaits = 0;
            }
        }
        boolean subjectFinishedBeforeRelease = subjectDone.getCount() == 0;
        // Retention rows the subject's transactions hold at the moment the owner is released.
        var heldRetention = admin.queryForList("SELECT l.OBJECT_NAME AS object_name, l.LOCK_MODE AS lock_mode,"
                + " l.LOCK_STATUS AS lock_status, l.ENGINE_TRANSACTION_ID AS trx, LEFT(t.PROCESSLIST_INFO, 90) AS current_sql"
                + " FROM performance_schema.data_locks l"
                + " JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID"
                + " WHERE l.OBJECT_SCHEMA = ? AND l.LOCK_TYPE = 'RECORD'"
                + " AND l.OBJECT_NAME IN ('qwen_tool_publication_tenant', 'qwen_runtime_placement_guard')"
                + " ORDER BY l.OBJECT_NAME, l.LOCK_STATUS", schema);
        long releaseAt = System.nanoTime();
        source.releaseOwner.countDown();
        boolean joined = subjectDone.await(90, TimeUnit.SECONDS) & ownerDone.await(90, TimeUnit.SECONDS);
        long deadlocksAfter = deadlocks(admin);
        result.put("subjectFinishedBeforeOwnerRelease", subjectFinishedBeforeRelease);
        result.put("subjectWaitingAtOwnerRelease", waitingAtRelease);
        result.set("lockWaitsAtRelease", waits);
        result.set("placementAndRetentionLocksAtRelease", JSON.valueToTree(heldRetention));
        result.put("joined", joined);
        result.put("ownerHeldPlacementMs", (releaseAt - subjectStart) / 1_000_000);
        result.put("subjectMs", subjectEnd[0] == 0 ? -1 : (subjectEnd[0] - subjectStart) / 1_000_000);
        result.put("owner", ownerError.get() == null ? "ok" : describe(ownerError.get()));
        result.put("subject", subjectError.get() == null ? "ok" : describe(subjectError.get()));
        result.put("innodbDeadlocks", deadlocksAfter - deadlocksBefore);
        result.set("timeline", source.timelineJson());
        source.holdOwner = false;
        // Post-checks on the committed state.
        if (subjectError.get() == null && receipt != null && scenario.contains("commit")) {
            JsonNode replay = f.admissions().commitReceipt(f.key(), "pub-1", WRITER_TOKEN, receipt.request());
            JsonNode replay2 = f.admissions().commitReceipt(f.key(), "pub-1", WRITER_TOKEN, receipt.request());
            result.put("receiptDecision", replay.path("decision").asText());
            result.put("replayStable", replay.equals(replay2));
            byte[] stored = f.journal().sessions.readResource("tenant-1", "workspace-1", "session-1",
                    receipt.root().path("resourceId").asText(), WRITER_TOKEN).bytes();
            result.put("sessionResourceMatchesOutcomeBytes",
                    java.util.Arrays.equals(stored, f.outcome().toString().getBytes(StandardCharsets.UTF_8)));
            result.put("producerPhase", f.journal().jdbc.queryForObject(
                    "SELECT producer_phase FROM qwen_tool_publication", String.class));
        }
        if (subjectError.get() == null && scenario.startsWith("prepare-") && !scenario.contains("commit")) {
            result.put("admissionVerified", f.journal().jdbc.queryForObject(
                    "SELECT state FROM qwen_tool_publication_object WHERE slot_key = 'admission'", String.class));
        }
        result.put("placementGuardRows", f.journal().jdbc.queryForObject(
                "SELECT COUNT(*) FROM qwen_runtime_placement_guard", Integer.class));
    }

    private void stress(String scenario, HookedDataSource source, JdbcTemplate admin, String schema,
            int seconds, ObjectNode result) throws Exception {
        Fixture f = fixture(source);
        finish(f);
        Receipt receipt = receipt(f, prepare(f));
        f.admissions().commitReceipt(f.key(), "pub-1", WRITER_TOKEN, receipt.request());
        boolean ambient = scenario.endsWith("ambient");
        long deadlocksBefore = deadlocks(admin);
        long stopAt = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        var counters = new ConcurrentHashMap<String, AtomicInteger>();
        var threads = new ArrayList<Thread>();
        for (int i = 0; i < 2; i++) {
            threads.add(new Thread(() -> {
                while (System.nanoTime() < stopAt) {
                    try {
                        if (ambient) {
                            new TransactionTemplate(f.journal().manager).execute(status -> f.admissions()
                                    .commitReceipt(f.key(), "pub-1", WRITER_TOKEN, receipt.request()));
                        } else {
                            f.admissions().commitReceipt(f.key(), "pub-1", WRITER_TOKEN, receipt.request());
                        }
                        counters.computeIfAbsent("receipt.ok", k -> new AtomicInteger()).incrementAndGet();
                    } catch (Throwable error) {
                        counters.computeIfAbsent("receipt." + kind(error), k -> new AtomicInteger())
                                .incrementAndGet();
                    }
                }
            }, "receipt-" + i));
            threads.add(new Thread(() -> {
                while (System.nanoTime() < stopAt) {
                    try {
                        authorizeOrdinary(f);
                        counters.computeIfAbsent("owner.ok", k -> new AtomicInteger()).incrementAndGet();
                    } catch (Throwable error) {
                        counters.computeIfAbsent("owner." + kind(error), k -> new AtomicInteger())
                                .incrementAndGet();
                    }
                }
            }, "owner-" + i));
        }
        threads.forEach(Thread::start);
        for (Thread thread : threads) {
            thread.join(TimeUnit.SECONDS.toMillis(seconds + 120));
        }
        result.put("seconds", seconds);
        result.set("counts", JSON.valueToTree(new java.util.TreeMap<>(counters)));
        result.put("innodbDeadlocks", deadlocks(admin) - deadlocksBefore);
        JsonNode replay = f.admissions().commitReceipt(f.key(), "pub-1", WRITER_TOKEN, receipt.request());
        result.put("receiptDecisionAfter", replay.path("decision").asText());
        result.put("producerPhase", f.journal().jdbc.queryForObject(
                "SELECT producer_phase FROM qwen_tool_publication", String.class));
    }

    private static String kind(Throwable error) {
        String text = describe(error);
        if (text.contains("Deadlock found")) {
            return "deadlock";
        }
        if (text.contains("Lock wait timeout")) {
            return "lockWaitTimeout";
        }
        return "other:" + text.substring(0, Math.min(120, text.length()));
    }

    private static long deadlocks(JdbcTemplate admin) {
        return admin.queryForObject("SELECT `count` FROM information_schema.innodb_metrics"
                + " WHERE name = 'lock_deadlocks'", Long.class);
    }

    private static List<Map<String, Object>> lockWaits(JdbcTemplate admin, String schema) {
        return admin.queryForList("SELECT rl.OBJECT_NAME AS waiting_on, rl.LOCK_MODE AS waiting_mode,"
                + " LEFT(rt.PROCESSLIST_INFO, 90) AS waiting_sql,"
                + " w.REQUESTING_ENGINE_TRANSACTION_ID AS waiting_trx, w.BLOCKING_ENGINE_TRANSACTION_ID AS blocking_trx"
                + " FROM performance_schema.data_lock_waits w"
                + " JOIN performance_schema.data_locks rl ON rl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID"
                + " JOIN performance_schema.threads rt ON rt.THREAD_ID = w.REQUESTING_THREAD_ID"
                + " WHERE rl.OBJECT_SCHEMA = ?", schema);
    }

    private static String describe(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        return error.getClass().getSimpleName() + ": " + String.valueOf(root.getMessage()).replace('\n', ' ');
    }

    /** Records placement/retention lock statements per thread and pauses the owner after placement. */
    private static final class HookedDataSource extends DelegatingDataSource {
        final CountDownLatch ownerHoldsPlacement = new CountDownLatch(1);
        final CountDownLatch releaseOwner = new CountDownLatch(1);
        final AtomicBoolean paused = new AtomicBoolean();
        final List<String[]> timeline = java.util.Collections.synchronizedList(new ArrayList<>());
        volatile boolean holdOwner;
        volatile long start = System.nanoTime();

        HookedDataSource(DataSource source) {
            super(source);
        }

        @Override
        public Connection getConnection() throws SQLException {
            return wrap(super.getConnection());
        }

        @Override
        public Connection getConnection(String user, String password) throws SQLException {
            return wrap(super.getConnection(user, password));
        }

        ArrayNode timelineJson() {
            ArrayNode rows = JSON.createArrayNode();
            synchronized (timeline) {
                for (String[] row : timeline) {
                    rows.add(JSON.createArrayNode().add(row[0]).add(row[1]).add(row[2]).add(row[3]));
                }
            }
            return rows;
        }

        private static String lockOf(String sql) {
            if (sql.contains("qwen_runtime_placement_guard")) {
                return "placement";
            }
            if (sql.contains("qwen_tool_publication_tenant")) {
                return "retention";
            }
            return null;
        }

        private Connection wrap(Connection connection) {
            return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Connection.class},
                    (proxy, method, args) -> {
                        try {
                            Object result = method.invoke(connection, args);
                            if (!method.getName().equals("prepareStatement")
                                    || !(result instanceof PreparedStatement statement)) {
                                return result;
                            }
                            String sql = (String) args[0];
                            String lock = lockOf(sql);
                            return Proxy.newProxyInstance(getClass().getClassLoader(),
                                    new Class<?>[] {PreparedStatement.class}, (prepared, call, values) -> {
                                        boolean execute = call.getName().startsWith("execute");
                                        String role = Thread.currentThread().getName();
                                        boolean tracked = execute && lock != null
                                                && (role.equals("owner") || role.equals("subject"));
                                        String verb = sql.startsWith("INSERT") ? "insert" : "for-update";
                                        if (tracked) {
                                            timeline.add(new String[] {
                                                    String.valueOf((System.nanoTime() - start) / 1_000_000),
                                                    role, lock + ":" + verb, "request"});
                                        }
                                        try {
                                            Object value = call.invoke(statement, values);
                                            if (tracked) {
                                                timeline.add(new String[] {
                                                        String.valueOf((System.nanoTime() - start) / 1_000_000),
                                                        role, lock + ":" + verb, "granted"});
                                            }
                                            if (execute && holdOwner && "owner".equals(role)
                                                    && "placement".equals(lock) && sql.startsWith("SELECT")
                                                    && paused.compareAndSet(false, true)) {
                                                ownerHoldsPlacement.countDown();
                                                if (!releaseOwner.await(60, TimeUnit.SECONDS)) {
                                                    throw new AssertionError("Owner hold timed out");
                                                }
                                            }
                                            return value;
                                        } catch (InvocationTargetException error) {
                                            if (tracked) {
                                                timeline.add(new String[] {
                                                        String.valueOf((System.nanoTime() - start) / 1_000_000),
                                                        role, lock + ":" + verb,
                                                        "error " + String.valueOf(error.getCause().getMessage())
                                                                .replace('\n', ' ')});
                                            }
                                            throw error.getCause();
                                        }
                                    });
                        } catch (InvocationTargetException error) {
                            throw error.getCause();
                        }
                    });
        }
    }
}
