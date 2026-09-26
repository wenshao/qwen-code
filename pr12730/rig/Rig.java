package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.qwen.code.runtimebroker.managedworkspace.ContextBinding;
import com.mysql.cj.jdbc.MysqlDataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import javax.sql.DataSource;

/**
 * Real-environment probe for PR 12730: the PR's own Broker classes, the real
 * Worker bundle, MySQL 8.4.7 and one JVM per Broker lifetime.
 */
public final class Rig {
    static final String DIGEST = "sha256:" + "c".repeat(64);
    static final SecretProtector PROTECTOR = new AesGcmSecretProtector("rig-key", new byte[32]);
    static final Path RIG = Path.of(System.getenv("RIG"));
    static final String ROOT = System.getenv("ROOT");
    static final String STORAGE = "storage:ws-a/2026";
    static final long T0 = System.nanoTime();

    public static void main(String[] args) throws Exception {
        say("jvm", "pid=" + ProcessHandle.current().pid() + " cmd=" + args[0] + " db=" + args[1]);
        switch (args[0]) {
            case "happy" -> happy(args[1]);
            case "warm" -> warmLoop(args[1], args[2], Boolean.parseBoolean(args[3]),
                    Integer.parseInt(args[4]), Long.parseLong(args[5]));
            case "legacy" -> legacy(args[1]);
            case "stale" -> stale(args[1]);
            case "unplaceable" -> unplaceable(args[1]);
            case "acquire" -> acquire(args[1]);
            default -> throw new IllegalArgumentException(args[0]);
        }
        System.out.flush();
        Runtime.getRuntime().halt(0);
    }

    // ---------------------------------------------------------------- helpers

    static void say(String step, String text) {
        System.out.printf("[%6.2fs] %-14s %s%n", (System.nanoTime() - T0) / 1e9, step, text);
        System.out.flush();
    }

    static DataSource ds(String db) {
        MysqlDataSource source = new MysqlDataSource();
        source.setURL("jdbc:mysql://127.0.0.1:13730/" + db
                + "?useUnicode=true&characterEncoding=utf8");
        source.setUser("root");
        source.setPassword("");
        return source;
    }

    static RuntimeScope scope(String workspace, String isolation, String root) {
        return new RuntimeScope("tenant-a", workspace, "7", root, DIGEST, isolation);
    }

    static LocalProcessRuntimeProvisioner provisioner(String mode, boolean managed,
            HttpRuntimeTransport transport) {
        List<String> command = List.of("/bin/sh", RIG.resolve("worker.sh").toString(), mode);
        return managed
                ? new LocalProcessRuntimeProvisioner(command, RIG, transport, ignored -> STORAGE)
                : new LocalProcessRuntimeProvisioner(command, RIG, transport);
    }

    static RuntimeBrokerService service(RuntimeScope scope, RuntimeProvisioner provisioner,
            HttpRuntimeTransport transport, RuntimeBindingRepository bindings, String owner,
            Duration lease) {
        return new RuntimeBrokerService(ignored -> CompletableFuture.completedFuture(scope),
                provisioner, transport, bindings, new InMemoryRuntimeSessionRepository(),
                new InMemoryToolExecutionRepository(), owner, lease, lease);
    }

    static String describe(Throwable error) {
        Throwable cause = error;
        while ((cause instanceof ExecutionException || cause instanceof CompletionException)
                && cause.getCause() != null) {
            cause = cause.getCause();
        }
        if (cause instanceof RuntimeBrokerException broker) {
            return broker.getStatusCode() + " " + broker.getCode() + " retryable="
                    + broker.isRetryable();
        }
        return cause.getClass().getSimpleName() + ": " + cause.getMessage();
    }

    static String sync(Runnable action) {
        try {
            action.run();
            return "ACCEPTED (no synchronous refusal)";
        } catch (RuntimeException refused) {
            return "refused before sending: " + describe(refused);
        }
    }

    static void dump(DataSource source, String sql) throws Exception {
        try (Connection connection = source.getConnection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            ResultSetMetaData meta = result.getMetaData();
            while (result.next()) {
                List<String> cells = new ArrayList<>();
                for (int i = 1; i <= meta.getColumnCount(); i++) {
                    String value = result.getString(i);
                    if (value != null && value.length() > 16
                            && meta.getColumnName(i).endsWith("key")
                            && !meta.getColumnName(i).startsWith("isolation")) {
                        value = value.substring(0, 12) + "…";
                    }
                    cells.add(meta.getColumnName(i) + "=" + value);
                }
                say("db", String.join(" ", cells));
            }
        }
    }

    static Set<Long> children() {
        return ProcessHandle.current().descendants().filter(ProcessHandle::isAlive)
                .map(ProcessHandle::pid).collect(Collectors.toSet());
    }

    static Map<String, Object> reference(String sessionId, String callId, String command) {
        Map<String, Object> reference = new LinkedHashMap<>();
        reference.put("sessionId", sessionId);
        reference.put("promptId", "prompt-1");
        reference.put("callId", callId);
        reference.put("argsDigest", "sha256:" + Integer.toHexString(command.hashCode()));
        reference.put("toolName", "run_shell_command");
        reference.put("input", Map.of("command", command, "is_background", false));
        return reference;
    }

    static RuntimeSessionRecord on(RuntimeBindingRecord runtime, RuntimeSession session) {
        return new RuntimeSessionRecord(session, runtime.getBindingId(), runtime.getGeneration(),
                RuntimeSessionRecord.State.READY, 0, Instant.now());
    }

    static String text(Map<String, Object> result) {
        String status = String.valueOf(result.get("executionStatus"));
        Object parts = result.get("responseParts");
        String body = String.valueOf(parts).replace("\n", "⏎").replace(ROOT, "<root>");
        if (!"success".equals(status)) {
            body = String.valueOf(result).replace("\n", "⏎").replace(ROOT, "<root>");
        }
        if (body.length() > 400) {
            body = body.substring(0, 400) + "…";
        }
        return status + " " + body;
    }

    // ------------------------------------------------------------ happy path

    static void happy(String db) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        JdbcRuntimeBindingRepository bindings = new JdbcRuntimeBindingRepository(source, PROTECTOR);
        RuntimeScope scope = scope("workspace-a", "session", ROOT);
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        Set<Long> before = children();
        LocalProcessRuntimeProvisioner provisioner = provisioner("real", true, transport);
        RuntimeBrokerService service = service(scope, provisioner, transport, bindings,
                "broker-1", Duration.ofSeconds(5));

        RuntimeBindingRecord a = service.warm("harness-a").toCompletableFuture().get(40, TimeUnit.SECONDS);
        RuntimeBindingRecord b = service.warm("harness-b").toCompletableFuture().get(40, TimeUnit.SECONDS);
        for (RuntimeBindingRecord record : List.of(a, b)) {
            say("warm", record.getRequest().getIsolationKey() + " -> " + record.getState()
                    + " managed=" + record.getRequest().isManagedContext()
                    + " storageId=" + record.getRequest().getStorageId()
                    + " attestGen=" + record.getAttestationGeneration()
                    + " endpoint=" + record.getLease().getEndpoint());
        }
        dump(source, "SELECT isolation_key, storage_id, provisioner_kind, request_key "
                + "FROM qwen_runtime_binding_slot ORDER BY isolation_key");
        dump(source, "SELECT isolation_key, binding_state, storage_id, runtime_generation "
                + "FROM qwen_runtime_binding ORDER BY isolation_key");

        ContextBinding api = new ContextBinding("tenant-a", "workspace-a", 7, STORAGE,
                "服务/api", "config:a", 1);
        ContextBinding web = new ContextBinding("tenant-a", "workspace-a", 7, STORAGE,
                "web/前端", "config:a", 1);
        ContextBinding missing = new ContextBinding("tenant-a", "workspace-a", 7, STORAGE,
                "missing/dir", "config:a", 1);
        RuntimeSession a1 = new RuntimeSession("harness-a", "sess-α-1", "bootstrap", scope);
        RuntimeSession a2 = new RuntimeSession("harness-a", "sess-🚀-2", "bootstrap", scope);
        RuntimeSession a3 = new RuntimeSession("harness-a", "sess-3", "bootstrap", scope);
        RuntimeSession b1 = new RuntimeSession("harness-b", "sess-b-1", "bootstrap", scope);

        Map<String, Object> r1 = transport.installContext(a, on(a, a1), "op-1", api)
                .toCompletableFuture().get(10, TimeUnit.SECONDS);
        Map<String, Object> r2 = transport.installContext(a, on(a, a2), "op-2", web)
                .toCompletableFuture().get(10, TimeUnit.SECONDS);
        say("install", "sess-α-1 -> 服务/api receipt keys=" + new java.util.TreeSet<>(r1.keySet()));
        say("install", "sess-α-1 receipt sessionId=" + r1.get("sessionId") + " runtime="
                + r1.get("runtimeInstanceId") + " epoch=" + r1.get("epoch")
                + " digest==binding: " + api.getContextDigest().equals(r1.get("contextDigest")));
        say("install", "sess-🚀-2 -> web/前端 receipt sessionId=" + r2.get("sessionId"));
        Map<String, Object> replay = transport.installContext(a, on(a, a1), "op-1", api)
                .toCompletableFuture().get(10, TimeUnit.SECONDS);
        say("replay", "same op-1 again -> identical receipt: " + replay.equals(r1));
        for (Object[] probe : new Object[][] {
                {"same op-1, changed binding", a1, "op-1", web},
                {"new op-9, changed binding", a1, "op-9", web},
                {"missing directory", a3, "op-4", missing}}) {
            try {
                transport.installContext(a, on(a, (RuntimeSession) probe[1]), (String) probe[2],
                        (ContextBinding) probe[3]).toCompletableFuture().get(10, TimeUnit.SECONDS);
                say("install", probe[0] + " -> ACCEPTED");
            } catch (Exception refused) {
                say("install", probe[0] + " -> " + describe(refused));
            }
        }

        say("execute", "sess-α-1 pwd -> " + text(transport.execute(a.getLease(), a1,
                reference("sess-α-1", "call-a1", "pwd")).toCompletableFuture().get(30, TimeUnit.SECONDS)));
        say("execute", "sess-🚀-2 pwd -> " + text(transport.execute(a.getLease(), a2,
                reference("sess-🚀-2", "call-a2", "pwd")).toCompletableFuture().get(30, TimeUnit.SECONDS)));
        try {
            Map<String, Object> never = transport.execute(a.getLease(), a3,
                    reference("sess-never", "call-n", "pwd")).toCompletableFuture().get(30, TimeUnit.SECONDS);
            say("execute", "uninstalled sess-never pwd -> " + text(never));
        } catch (Exception refused) {
            say("execute", "uninstalled sess-never pwd -> " + describe(refused));
        }

        // Refusals that must happen before any byte is sent.
        RuntimeScope otherWorkspace = scope("workspace-b", "session", ROOT);
        RuntimeScope otherRoot = scope("workspace-a", "session", ROOT + "-other");
        RuntimeBindingRecord blocked = a.withState(RuntimeBindingRecord.State.RECOVERY_BLOCKED,
                a.getLease(), Instant.now());
        say("refuse", "harness-a Session on harness-b Runtime: " + sync(() ->
                transport.installContext(b, on(a, a1), "op-x1", api)));
        say("refuse", "harness-a Session record naming harness-b's binding: " + sync(() ->
                transport.installContext(b, on(b, a1), "op-x5", api)));
        say("refuse", "Session record acquired at another generation: " + sync(() ->
                transport.installContext(a, new RuntimeSessionRecord(a1, a.getBindingId(),
                        a.getGeneration() + 1, RuntimeSessionRecord.State.READY, 0, Instant.now()),
                        "op-x6", api)));
        say("refuse", "Session of another Workspace: " + sync(() ->
                transport.installContext(a, on(a, new RuntimeSession("harness-a", "sess-ws-b",
                        "bootstrap", otherWorkspace)), "op-x2", api)));
        say("refuse", "Session whose scope differs only in mount root: " + sync(() ->
                transport.installContext(a, on(a, new RuntimeSession("harness-a", "sess-root",
                        "bootstrap", otherRoot)), "op-x3", api)));
        say("refuse", "RECOVERY_BLOCKED record: " + sync(() ->
                transport.installContext(blocked, on(a, a1), "op-x4", api)));
        say("refuse", "Runtime Session ID \"s\\uD800\": " + sync(() ->
                new RuntimeSession("harness-a", "s\uD800", "bootstrap", scope)));
        say("refuse", "execute reference callId \"c\\uDC00\": " + sync(() ->
                transport.execute(a.getLease(), a1, reference("sess-α-1", "c\uDC00", "pwd"))));
        say("refuse", "status reference promptId \"p\\uD83D\": " + sync(() -> {
            Map<String, Object> ref = reference("sess-α-1", "call-a1", "pwd");
            ref.put("promptId", "p\uD83D");
            transport.status(a.getLease(), a1, ref, 0);
        }));
        say("control", "valid surrogate pair in Session ID accepted: " + sync(() ->
                new RuntimeSession("harness-a", "s-🚀", "bootstrap", scope)));

        // Remove one Session's directory while its call is running.
        Map<String, Object> longRef = reference("sess-🚀-2", "call-long",
                "node -e \"setTimeout(() => {}, 3000)\" && echo still-here && pwd");
        CompletableFuture<Map<String, Object>> running = transport.execute(a.getLease(), a2,
                longRef).toCompletableFuture();
        running.whenComplete((value, error) -> say("dir-loss", "call-long future completed"));
        Map<String, Object> cancelRef = reference("sess-🚀-2", "call-cancel",
                "node -e \"setTimeout(() => {}, 8000)\" && echo never-printed");
        CompletableFuture<Map<String, Object>> toCancel = transport.execute(a.getLease(), a2,
                cancelRef).toCompletableFuture();
        Thread.sleep(1200);
        Path webDir = Path.of(ROOT, "web", "前端");
        try (var paths = Files.walk(webDir)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.delete(path);
            }
        }
        say("dir-loss", "deleted " + webDir.getFileName() + " while call-long runs; exists="
                + Files.exists(webDir));
        say("dir-loss", "status(call-long) while running -> "
                + transport.status(a.getLease(), a2, longRef, 0).toCompletableFuture()
                        .get(10, TimeUnit.SECONDS).get("state"));
        Map<String, Object> cancelled = transport.cancel(a.getLease(), a2, cancelRef)
                .toCompletableFuture().get(10, TimeUnit.SECONDS);
        say("dir-loss", "cancel(call-cancel) while running -> " + cancelled.get("state"));
        say("dir-loss", "call-cancel settles -> " + text(toCancel.get(30, TimeUnit.SECONDS)));
        Map<String, Object> settled = running.get(30, TimeUnit.SECONDS);
        say("dir-loss", "call-long settles -> " + text(settled));
        say("dir-loss", "status(call-long) after -> "
                + transport.status(a.getLease(), a2, longRef, 0).toCompletableFuture()
                        .get(10, TimeUnit.SECONDS).get("state"));
        Map<String, Object> replayed = transport.execute(a.getLease(), a2, longRef)
                .toCompletableFuture().get(10, TimeUnit.SECONDS);
        say("dir-loss", "replay execute(call-long) -> identical result: " + replayed.equals(settled));
        say("dir-loss", "cancel(call-long) -> " + transport.cancel(a.getLease(), a2, longRef)
                .toCompletableFuture().get(10, TimeUnit.SECONDS).get("state"));
        try {
            Map<String, Object> after = transport.execute(a.getLease(), a2,
                    reference("sess-🚀-2", "call-after", "pwd")).toCompletableFuture()
                    .get(30, TimeUnit.SECONDS);
            say("dir-loss", "new call in sess-🚀-2 -> " + text(after));
        } catch (Exception refused) {
            say("dir-loss", "new call in sess-🚀-2 -> " + describe(refused));
        }
        say("dir-loss", "sess-α-1 still usable -> " + text(transport.execute(a.getLease(), a1,
                reference("sess-α-1", "call-a1b", "pwd")).toCompletableFuture().get(30, TimeUnit.SECONDS)));

        // The other Harness Session's Runtime is independent.
        Map<String, Object> rb = transport.installContext(b, on(b, b1), "op-b1", api)
                .toCompletableFuture().get(10, TimeUnit.SECONDS);
        say("harness-b", "install sess-b-1 on harness-b runtime=" + rb.get("runtimeInstanceId")
                + " (harness-a runtime=" + a.getLease().getRuntimeInstanceId() + ")");
        say("harness-b", "sess-b-1 pwd -> " + text(transport.execute(b.getLease(), b1,
                reference("sess-b-1", "call-b1", "pwd")).toCompletableFuture().get(30, TimeUnit.SECONDS)));

        // Reconstruct the Broker and repository from the same MySQL database.
        provisioner.confirm(a.getRequest(), a.getLease()).toCompletableFuture().get(5, TimeUnit.SECONDS);
        RuntimeBrokerService restored = service(scope, provisioner, transport,
                new JdbcRuntimeBindingRepository(source, PROTECTOR), "broker-2", Duration.ofSeconds(5));
        RuntimeBindingRecord adopted = restored.warm("harness-a").toCompletableFuture()
                .get(30, TimeUnit.SECONDS);
        say("restore", "new Broker+repository warm(harness-a) -> " + adopted.getState()
                + " same binding=" + adopted.getBindingId().equals(a.getBindingId())
                + " storageId=" + adopted.getRequest().getStorageId()
                + " attestGen=" + adopted.getAttestationGeneration());
        Set<Long> during = children();
        during.removeAll(before);
        say("cleanup", "worker processes before close=" + during.size());
        restored.close();
        service.close();
        provisioner.close();
        Thread.sleep(1500);
        Set<Long> after = children();
        after.removeAll(before);
        say("cleanup", "worker processes after close=" + after.size());
    }

    // --------------------------------------------------- failure and restart

    /** One Broker lifetime: warm a few times against the given mode. */
    static void warmLoop(String db, String mode, boolean managed, int times, long watchSeconds)
            throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        RuntimeScope scope = scope("workspace-a", "workspace", ROOT);
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = provisioner(mode, managed, transport);
        RuntimeBrokerService service = service(scope, provisioner, transport,
                new JdbcRuntimeBindingRepository(source, PROTECTOR), "broker-" + mode + "-"
                        + ProcessHandle.current().pid(), Duration.ofSeconds(2));
        Set<Long> before = children();
        for (int index = 1; index <= times; index++) {
            long start = System.nanoTime();
            String outcome;
            while (true) {
                try {
                    RuntimeBindingRecord record = service.warm("harness").toCompletableFuture()
                            .get(60, TimeUnit.SECONDS);
                    outcome = record.getState() + " storageId=" + record.getRequest().getStorageId();
                } catch (Exception failure) {
                    outcome = describe(failure);
                }
                // Another (dead) Broker may still hold the operation lease.
                if (outcome.contains("runtime_provisioning_in_progress")
                        && System.nanoTime() - start < 15_000_000_000L) {
                    Thread.sleep(500);
                    continue;
                }
                break;
            }
            say("warm#" + index, String.format("%s  (%.1fs)", outcome,
                    (System.nanoTime() - start) / 1e9));
        }
        dump(source, "SELECT binding_state, runtime_generation, storage_id, "
                + "resource_handle_json IS NOT NULL AS has_handle, runtime_lease_id IS NOT NULL AS has_lease "
                + "FROM qwen_runtime_binding");
        long step = Long.parseLong(System.getenv().getOrDefault("WATCH_STEP", "5"));
        for (long second = 0; second < watchSeconds; second += step) {
            Thread.sleep(step * 1000);
            Set<Long> now = children();
            now.removeAll(before);
            say("watch", "t+" + (second + step) + "s live child processes=" + now.size()
                    + " " + now);
        }
        if (watchSeconds > 0) {
            dump(source, "SELECT binding_state, runtime_lease_id IS NOT NULL AS has_lease "
                    + "FROM qwen_runtime_binding");
        }
    }

    static void legacy(String db) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        RuntimeScope scope = scope("workspace-a", "workspace", ROOT);
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = provisioner("real", false, transport);
        RuntimeBrokerService service = service(scope, provisioner, transport,
                new JdbcRuntimeBindingRepository(source, PROTECTOR), "broker-legacy",
                Duration.ofSeconds(5));
        RuntimeBindingRecord record = service.warm("harness").toCompletableFuture()
                .get(40, TimeUnit.SECONDS);
        say("legacy", "warm -> " + record.getState() + " managed="
                + record.getRequest().isManagedContext() + " storageId="
                + record.getRequest().getStorageId() + " attestGen="
                + record.getAttestationGeneration());
        dump(source, "SELECT storage_id, provisioner_kind, request_key FROM qwen_runtime_binding_slot");
        ContextBinding api = new ContextBinding("tenant-a", "workspace-a", 7, STORAGE,
                "服务/api", "config:a", 1);
        say("legacy", "installContext on a legacy binding: " + sync(() -> transport.installContext(
                record, on(record, new RuntimeSession("harness", "sess-l", "bootstrap", scope)), "op-l", api)));
        service.close();
        provisioner.close();
    }

    /** The transport checks the record it is handed; how fresh is that record? */
    static void stale(String db) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        JdbcRuntimeBindingRepository bindings = new JdbcRuntimeBindingRepository(source, PROTECTOR);
        RuntimeScope scope = scope("workspace-a", "workspace", ROOT);
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = provisioner("real", true, transport);
        RuntimeBrokerService service = service(scope, provisioner, transport, bindings,
                "broker-stale", Duration.ofSeconds(5));
        RuntimeBindingRecord snapshot = service.warm("harness").toCompletableFuture()
                .get(40, TimeUnit.SECONDS);
        RuntimeBindingRecord current = bindings.claimOperation(snapshot.getBindingId(),
                "operator", Duration.ofMinutes(1));
        RuntimeBindingRecord blocked = bindings.compareAndSet(current, current.withState(
                RuntimeBindingRecord.State.RECOVERY_BLOCKED, current.getLease(), Instant.now()));
        bindings.releaseOperation(snapshot.getBindingId(), "operator",
                current.getOperationGeneration());
        say("stale", "database now says " + bindings.findById(snapshot.getBindingId()).getState()
                + " (CAS ok=" + (blocked != null) + ")");
        ContextBinding api = new ContextBinding("tenant-a", "workspace-a", 7, STORAGE,
                "服务/api", "config:a", 1);
        RuntimeSession session = new RuntimeSession("harness", "sess-stale", "bootstrap", scope);
        try {
            Map<String, Object> receipt = transport.installContext(snapshot, on(snapshot, session), "op-s", api)
                    .toCompletableFuture().get(10, TimeUnit.SECONDS);
            say("stale", "install with the caller's earlier READY snapshot -> receipt for "
                    + receipt.get("sessionId"));
        } catch (Exception failure) {
            say("stale", "install with earlier READY snapshot -> " + describe(failure));
        }
        RuntimeSession released = new RuntimeSession("harness", "sess-released", "bootstrap", scope);
        try {
            Map<String, Object> receipt = transport.installContext(snapshot, new RuntimeSessionRecord(
                    released, snapshot.getBindingId(), snapshot.getGeneration(),
                    RuntimeSessionRecord.State.RELEASED, 3, Instant.now()), "op-r", api)
                    .toCompletableFuture().get(10, TimeUnit.SECONDS);
            say("stale", "install with a RELEASED Session record -> receipt for "
                    + receipt.get("sessionId"));
        } catch (Exception failure) {
            say("stale", "install with a RELEASED Session record -> " + describe(failure));
        }
        RuntimeBindingRecord fresh = bindings.findById(snapshot.getBindingId());
        say("stale", "install with a fresh read (" + fresh.getState() + ") -> " + sync(() ->
                transport.installContext(fresh, on(fresh, session), "op-s2", api)));
        service.close();
        provisioner.close();
    }

    /** A configured resolver that has no storage for a scope. */
    static void unplaceable(String db) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        RuntimeScope scope = scope("workspace-a", "workspace", ROOT);
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = new LocalProcessRuntimeProvisioner(
                List.of("/bin/sh", RIG.resolve("worker.sh").toString(), "real"), RIG, transport,
                ignored -> null);
        RuntimeBrokerService service = service(scope, provisioner, transport,
                new JdbcRuntimeBindingRepository(source, PROTECTOR), "broker-unplaceable",
                Duration.ofSeconds(5));
        for (int index = 1; index <= 2; index++) {
            try {
                service.warm("harness").toCompletableFuture().get(20, TimeUnit.SECONDS);
                say("unplaceable", "warm#" + index + " -> ACCEPTED");
            } catch (Exception failure) {
                say("unplaceable", "warm#" + index + " -> " + describe(failure));
            }
        }
        try (Connection connection = source.getConnection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("SELECT (SELECT COUNT(*) FROM "
                        + "qwen_runtime_binding_slot), (SELECT COUNT(*) FROM qwen_runtime_binding)")) {
            result.next();
            say("unplaceable", "rows recorded: slots=" + result.getInt(1) + " bindings="
                    + result.getInt(2));
        }
        service.close();
        provisioner.close();
    }

    /** Can the service produce a Session record with the real HTTP transport? */
    static void acquire(String db) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        RuntimeScope scope = scope("workspace-a", "workspace", ROOT);
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = provisioner("real", true, transport);
        JdbcRuntimeSessionRepository sessions = new JdbcRuntimeSessionRepository(source);
        RuntimeBrokerService service = new RuntimeBrokerService(
                ignored -> CompletableFuture.completedFuture(scope), provisioner, transport,
                new JdbcRuntimeBindingRepository(source, PROTECTOR), sessions,
                new InMemoryToolExecutionRepository(), "broker-acquire", Duration.ofSeconds(5),
                Duration.ofSeconds(5));
        try {
            RuntimeSessionRecord record = service.acquire("harness", "sess-acq", "bootstrap")
                    .toCompletableFuture().get(40, TimeUnit.SECONDS);
            say("acquire", "service.acquire -> " + record.getState());
        } catch (Exception failure) {
            say("acquire", "service.acquire -> " + describe(failure));
        }
        dump(source, "SELECT runtime_session_id, session_state, binding_id IS NOT NULL AS has_binding "
                + "FROM qwen_runtime_session");
        service.close();
        provisioner.close();
    }
}
