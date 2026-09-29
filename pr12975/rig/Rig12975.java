package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.qwen.code.runtimebroker.managedworkspace.ContextBinding;
import com.mysql.cj.jdbc.MysqlDataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;

/**
 * Real-environment probe for PR 12975: the arm's own Broker classes, the real
 * Worker bundle (through worker.sh), MySQL 8.4 in Docker, one JVM per run.
 * The JVM runs with an HTTP proxy (the wire tap) for the Broker -> Worker hop.
 */
public final class Rig12975 {
    static final String DIGEST = "sha256:" + "c".repeat(64);
    static final SecretProtector PROTECTOR = new AesGcmSecretProtector("rig-key", new byte[32]);
    static final Path RIG = Path.of(System.getenv("RIG"));
    static final String ROOT = System.getenv("ROOT");
    static final String STORAGE = "storage:ws-a/2026";
    static final long T0 = System.nanoTime();

    public static void main(String[] args) throws Exception {
        say("jvm", "pid=" + ProcessHandle.current().pid() + " cmd=" + String.join(" ", args));
        switch (args[0]) {
            case "install" -> install(args[1]);
            case "startup" -> startup(args[1], args[2], Long.parseLong(args[3]));
            default -> throw new IllegalArgumentException(args[0]);
        }
        System.out.flush();
        Runtime.getRuntime().halt(0);
    }

    static void say(String step, String text) {
        System.out.printf("[%6.2fs] %-10s %s%n", (System.nanoTime() - T0) / 1e9, step, text);
        System.out.flush();
    }

    static DataSource ds(String db) {
        MysqlDataSource source = new MysqlDataSource();
        source.setURL("jdbc:mysql://127.0.0.1:13975/" + db
                + "?useUnicode=true&characterEncoding=utf8&allowPublicKeyRetrieval=true&useSSL=false");
        source.setUser("root");
        source.setPassword("");
        return source;
    }

    static RuntimeScope scope(String isolation) {
        return new RuntimeScope("tenant-a", "workspace-a", "7", ROOT, DIGEST, isolation);
    }

    static LocalProcessRuntimeProvisioner provisioner(String mode, HttpRuntimeTransport transport) {
        return new LocalProcessRuntimeProvisioner(
                List.of("/bin/sh", RIG.resolve("worker.sh").toString(), mode), RIG, transport,
                ignored -> STORAGE);
    }

    static String describe(Throwable error) {
        Throwable cause = error;
        while ((cause instanceof ExecutionException || cause instanceof CompletionException)
                && cause.getCause() != null) {
            cause = cause.getCause();
        }
        String text = cause instanceof RuntimeBrokerException broker
                ? broker.getStatusCode() + " " + broker.getCode() + " retryable=" + broker.isRetryable()
                : cause.getClass().getSimpleName() + ": " + cause.getMessage();
        List<String> suppressed = new ArrayList<>();
        for (Throwable one : cause.getSuppressed()) {
            suppressed.add(one.getClass().getSimpleName() + "(" + firstLine(one) + ")");
        }
        Throwable inner = cause.getCause();
        if (inner != null) {
            for (Throwable one : inner.getSuppressed()) {
                suppressed.add("cause." + one.getClass().getSimpleName() + "(" + firstLine(one) + ")");
            }
        }
        return text + " suppressed=" + suppressed;
    }

    static String firstLine(Throwable one) {
        Throwable root = one;
        while (root.getCause() != null) {
            root = root.getCause();
        }
        String message = String.valueOf(root.getMessage());
        return root.getClass().getSimpleName() + ": " + message.split("\n")[0];
    }

    static long contextRequests() throws Exception {
        Path ledger = Path.of(System.getenv("LEDGER"));
        if (!Files.exists(ledger)) {
            return 0;
        }
        return Files.readAllLines(ledger).stream().filter(line -> line.contains("/v3/context")).count();
    }

    static String bindingRow(DataSource source) throws Exception {
        try (Connection connection = source.getConnection();
                Statement statement = connection.createStatement();
                ResultSet row = statement.executeQuery("SELECT binding_state, "
                        + "resource_handle_json IS NOT NULL, runtime_lease_id IS NOT NULL "
                        + "FROM qwen_runtime_binding")) {
            List<String> rows = new ArrayList<>();
            while (row.next()) {
                rows.add(row.getString(1) + " handle=" + row.getBoolean(2) + " lease=" + row.getBoolean(3));
            }
            return rows.toString();
        }
    }

    // ------------------------------------------------ installation matrix

    static void install(String db) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        JdbcRuntimeBindingRepository bindings = new JdbcRuntimeBindingRepository(source, PROTECTOR);
        RuntimeScope scope = scope("session");
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = provisioner("real", transport);
        RuntimeBrokerService service = new RuntimeBrokerService(
                ignored -> CompletableFuture.completedFuture(scope), provisioner, transport,
                bindings, new JdbcRuntimeSessionRepository(source),
                new JdbcToolExecutionRepository(source), "broker-install",
                Duration.ofSeconds(5), Duration.ofSeconds(5));
        RuntimeBindingRecord ready = service.warm("harness-a").toCompletableFuture().get(60, TimeUnit.SECONDS);
        say("warm", ready.getState() + " managed=" + ready.getRequest().isManagedContext()
                + " generation=" + ready.getGeneration());
        ContextBinding api = new ContextBinding("tenant-a", "workspace-a", 7, STORAGE,
                "服务/api", "config:a", 1);
        RuntimeBindingRecord draining = new RuntimeBindingRecord(ready.getBindingId(),
                ready.getRequest(), ready.getProvisionSeed(), ready.getGeneration(), ready.getState(),
                ready.getLease(), ready.getResourceHandle(), ready.getAttestationGeneration(), true,
                ready.getOperationOwner(), ready.getOperationLeaseUntil(),
                ready.getOperationGeneration(), ready.getVersion(), ready.getLastHealthAt(),
                ready.getLastReconciledAt(), ready.getLastActiveAt(), ready.getLossEvidence(),
                ready.getStopEvidence());
        int index = 0;
        for (Object[] probe : new Object[][] {
                {"ACQUIRING", RuntimeSessionRecord.State.ACQUIRING, ready},
                {"READY", RuntimeSessionRecord.State.READY, ready},
                {"RELEASING", RuntimeSessionRecord.State.RELEASING, ready},
                {"RELEASED", RuntimeSessionRecord.State.RELEASED, ready},
                {"FAILED", RuntimeSessionRecord.State.FAILED, ready},
                {"READY, binding drain requested", RuntimeSessionRecord.State.READY, draining}}) {
            index++;
            RuntimeSession session = new RuntimeSession("harness-a", "sess-" + index, "bootstrap", scope);
            RuntimeBindingRecord binding = (RuntimeBindingRecord) probe[2];
            RuntimeSessionRecord record = new RuntimeSessionRecord(session, binding.getBindingId(),
                    binding.getGeneration(), (RuntimeSessionRecord.State) probe[1], 1, Instant.now());
            long before = contextRequests();
            String outcome;
            try {
                Map<String, Object> receipt = transport.installContext(binding, record,
                        "op-" + index, api).toCompletableFuture().get(20, TimeUnit.SECONDS);
                outcome = "INSTALLED receipt sessionId=" + receipt.get("sessionId");
            } catch (IllegalArgumentException refused) {
                outcome = "REFUSED before sending: " + refused.getMessage();
            } catch (Exception failed) {
                outcome = "FAILED " + describe(failed);
            }
            Thread.sleep(150);
            say("install", String.format("%-31s -> %s | Worker /v3/context requests +%d",
                    probe[0], outcome, contextRequests() - before));
        }
        service.close();
        provisioner.close();
    }

    // ------------------------------------------------ startup deadline

    /** One managed-context warm with the given worker mode and lease. */
    static void startup(String db, String mode, long leaseMillis) throws Exception {
        DataSource source = ds(db);
        JdbcRuntimeBrokerSchema.initialize(source);
        // A real MySQL fault on the recovery-block write, armed by env TRIGGER.
        String trigger = System.getenv().getOrDefault("TRIGGER", "none");
        if (!"none".equals(trigger)) {
            String action = trigger.startsWith("sleep:")
                    ? "SET @rig = SLEEP(" + Double.parseDouble(trigger.substring(6)) + ");"
                    : "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'rig: recovery block write refused';";
            try (Connection connection = source.getConnection();
                    Statement statement = connection.createStatement()) {
                statement.execute("DROP TRIGGER IF EXISTS rig_block");
                statement.execute("CREATE TRIGGER rig_block BEFORE UPDATE ON qwen_runtime_binding "
                        + "FOR EACH ROW BEGIN IF NEW.binding_state = 'RECOVERY_BLOCKED' "
                        + "AND OLD.binding_state <> 'RECOVERY_BLOCKED' THEN " + action
                        + " END IF; END");
            }
            say("trigger", "armed " + trigger + " on the RECOVERY_BLOCKED write");
        }
        HttpRuntimeTransport transport = new HttpRuntimeTransport();
        LocalProcessRuntimeProvisioner provisioner = provisioner(mode, transport);
        RuntimeScope scope = scope("workspace");
        RuntimeBrokerService service = new RuntimeBrokerService(
                ignored -> CompletableFuture.completedFuture(scope), provisioner, transport,
                new JdbcRuntimeBindingRepository(source, PROTECTOR),
                new InMemoryRuntimeSessionRepository(), new InMemoryToolExecutionRepository(),
                "broker-" + mode, Duration.ofMillis(leaseMillis), Duration.ofMillis(leaseMillis));
        long start = System.nanoTime();
        String outcome;
        try {
            RuntimeBindingRecord record = service.warm("harness").toCompletableFuture()
                    .get(90, TimeUnit.SECONDS);
            outcome = "OK " + record.getState();
        } catch (Exception failure) {
            outcome = describe(failure);
        }
        say("answer", String.format("%s (%.2fs; deadline=%dms)", outcome,
                (System.nanoTime() - start) / 1e9, leaseMillis * 4));
        Thread.sleep(Long.parseLong(System.getenv().getOrDefault("SETTLE_MS", "0")));
        say("db", bindingRow(source));
        service.close();
        provisioner.close();
    }

    static {
        if (System.getenv("RIG") == null) {
            throw new IllegalStateException("RIG is required; args=" + Arrays.toString(new String[0]));
        }
    }
}
