package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.HARNESS;
import static com.alibaba.qwen.code.runtimebroker.FaultGateRig.SESSION;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.h2.tools.Server;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Round-2 probes for PR 12839 (W0e-1). Log-only: the same file runs on the
 * design-only head (old behaviour) and on the implementation head, and the
 * logs in $W0E_OUT/<probe>.log are compared. Needs -Pfault-gates.
 */
@Tag("fault-gate")
class W0eR2ProbeTest {
    private static final Path OUT = Path.of(System.getenv()
            .getOrDefault("W0E_OUT", System.getProperty("java.io.tmpdir")));
    private static final String SECRET_KEY = java.util.Base64.getEncoder()
            .encodeToString("fault-gate-secret-key-0123456789"
                    .getBytes(StandardCharsets.US_ASCII));
    private static final String ESCAPE = String.join("\n",
            "use POSIX (); use Time::HiRes ();",
            "exit 0 if fork;",
            "POSIX::setsid();",
            "exit 0 if fork;",
            "open STDIN, '<', '/dev/null'; open STDOUT, '>', '/dev/null';",
            "open STDERR, '>', '/dev/null';",
            "open my $p, '>', 'escaped.pid'; print $p \"$$\\n\"; close $p;",
            "for (1..600) { open my $f, '>>', 'escaped';",
            "  printf $f \"old %d\\n\", int(Time::HiRes::time()*1000);",
            "  close $f; Time::HiRes::sleep(0.2); }",
            "");

    private FaultGateRig rig;
    private final List<AutoCloseable> extras = new ArrayList<>();
    private final List<Long> escapedPids = new ArrayList<>();

    @BeforeEach
    void openRig() throws Exception {
        Files.createDirectories(OUT);
        rig = FaultGateRig.open();
    }

    @AfterEach
    void closeRig() throws Exception {
        for (long pid : escapedPids) {
            ProcessHandle.of(pid).ifPresent(ProcessHandle::destroyForcibly);
        }
        for (int i = extras.size() - 1; i >= 0; i--) {
            try {
                extras.get(i).close();
            } catch (Exception ignored) {
                // best effort
            }
        }
        if (rig != null) {
            rig.close();
        }
    }

    /**
     * A1: one attestation exchange fails while the worker stays alive and
     * healthy. What happens to this placement, to another Workspace of the
     * same tenant, and to another tenant?
     */
    @Test
    void a1TransientAttestationFaultOnAHealthyWorker() throws Exception {
        String probe = "a1-transient-attest";
        FaultProxy proxy = rig.proxy();
        BrokerProcess a = rig.broker("a", proxy,
                FaultGateRig.Provisioner.LOCAL_PROCESS);
        warm(probe, "a warm (setup)", a, HARNESS);
        a.acquire(HARNESS, SESSION).requireOk();
        String first = a.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "echo one >> marker")).object()
                .getString("executionCallId");
        FaultGateRig.await(() -> rig.execution(first).getState().name(),
                "SETTLED"::equals, "call-1 settled");
        String bindingId = rig.execution(first).getBindingId();
        ProcessHandle worker = a.workers().get(0);
        log(probe, "setup: binding " + id(bindingId) + " READY, call-1 SETTLED,"
                + " worker " + worker.pid() + " alive; attest count "
                + proxy.count("attest"));

        proxy.schedule("attest", FaultProxy.Action.RESET);
        log(probe, "inject: next attest exchange reset once (worker untouched)");
        warm(probe, "a warm #1 (fault)", a, HARNESS);
        state(probe, bindingId, worker);
        for (int attempt = 2; attempt <= 4; attempt++) {
            Thread.sleep(1_000);
            warm(probe, "a warm #" + attempt + " (no fault)", a, HARNESS);
        }
        state(probe, bindingId, worker);
        reply(probe, "a create key-2 on the same Session", a.create(HARNESS,
                SESSION, "key-2", FaultGateRig.shell("call-2",
                        "echo two >> marker")));
        reply(probe, "a release Session", a.release(HARNESS, SESSION));
        log(probe, "attest exchanges " + proxy.count("attest") + "; marker "
                + rig.marker("marker") + "; a.workers=" + a.workers().size());

        Path other = Files.createDirectories(rig.root.resolve("workspace-b"))
                .toRealPath();
        BrokerProcess b = scoped("b", "tenant-a", "workspace-b", other,
                "workspace", rig.proxy());
        warm(probe, "tenant-a / workspace-b warm (new placement)", b,
                "harness-b");
        Path third = Files.createDirectories(rig.root.resolve("workspace-c"))
                .toRealPath();
        BrokerProcess c = scoped("c", "tenant-b", "workspace-c", third,
                "workspace", rig.proxy());
        warm(probe, "tenant-b / workspace-c warm (control)", c, "harness-c");
        Thread.sleep(3_000);
        state(probe, bindingId, worker);
    }

    /**
     * A2: the managed-agent-server default isolationClass is "session", so
     * each Hosted Session is its own placement. Same one-shot fault.
     */
    @Test
    void a2SessionIsolationDefault() throws Exception {
        String probe = "a2-session-isolation";
        FaultProxy proxy = rig.proxy();
        BrokerProcess a = scoped("a", "tenant-a", "workspace-a",
                rig.workspace, "session", proxy);
        warm(probe, "harness-1 warm (setup)", a, "harness-1");
        warm(probe, "harness-2 warm (setup, second Session)", a, "harness-2");
        proxy.schedule("attest", FaultProxy.Action.RESET);
        log(probe, "inject: next attest exchange reset once");
        warm(probe, "harness-1 warm (fault)", a, "harness-1");
        warm(probe, "harness-1 warm (no fault)", a, "harness-1");
        warm(probe, "harness-2 warm (existing placement)", a, "harness-2");
        warm(probe, "harness-3 warm (new Session)", a, "harness-3");
        warm(probe, "harness-4 warm (new Session)", a, "harness-4");
        log(probe, "workers alive under a: " + a.workers().size());
    }

    /**
     * A3: the worker is slow, not dead: one attestation response arrives
     * after the request timeout (rig 10 s; production 30 s).
     */
    @Test
    void a3SlowAttestationOnAHealthyWorker() throws Exception {
        String probe = "a3-slow-attest";
        FaultProxy proxy = rig.proxy();
        BrokerProcess a = rig.broker("a", proxy,
                FaultGateRig.Provisioner.LOCAL_PROCESS);
        warm(probe, "warm (setup)", a, HARNESS);
        a.acquire(HARNESS, SESSION).requireOk();
        String bindingId = rig.activeBinding().getBindingId();
        ProcessHandle worker = a.workers().get(0);
        proxy.schedule("attest", FaultProxy.Fault.delay(
                java.time.Duration.ofSeconds(12)));
        log(probe, "inject: next attest response delayed 12 s (request"
                + " timeout " + FaultGateRig.REQUEST_TIMEOUT.toSeconds()
                + " s)");
        warm(probe, "warm #1 (slow attest)", a, HARNESS);
        state(probe, bindingId, worker);
        Thread.sleep(3_000);
        warm(probe, "warm #2 (no fault)", a, HARNESS);
        state(probe, bindingId, worker);
        reply(probe, "create on the Session", a.create(HARNESS, SESSION,
                "key-9", FaultGateRig.shell("call-9", "echo nine >> marker")));
        log(probe, "marker " + rig.marker("marker"));
    }

    /** B1: round-1 P1 on this head (worker killed under a live Broker). */
    @Test
    void b1WorkerDeathUnderALiveBroker() throws Exception {
        String probe = "b1-worker-death";
        Files.writeString(rig.workspace.resolve("escape.pl"), ESCAPE);
        BrokerProcess broker = rig.broker("broker", rig.proxy(),
                FaultGateRig.Provisioner.LOCAL_PROCESS);
        warm(probe, "warm (setup)", broker, HARNESS);
        broker.acquire(HARNESS, SESSION).requireOk();
        String execution = broker.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "perl escape.pl;"
                        + " echo start >> marker; sleep 30;"
                        + " echo end >> marker")).object()
                .getString("executionCallId");
        rig.awaitMarker("marker", List.of("start"));
        long writer = awaitPid(rig.workspace.resolve("escaped.pid"));
        String bindingId = rig.execution(execution).getBindingId();
        log(probe, "escaped writer " + writer + " parent "
                + ProcessHandle.of(writer).flatMap(ProcessHandle::parent)
                        .map(p -> Long.toString(p.pid())).orElse("?"));
        rig.killWorker(broker);
        log(probe, "SIGKILLed worker tree");
        FaultGateRig.await(() -> rig.execution(execution).getState().name(),
                s -> !s.equals("EXECUTING") && !s.equals("DISPATCHING"),
                "call-1 left EXECUTING");
        log(probe, "call-1 " + rig.execution(execution).getState()
                + "; binding " + rig.bindings.findById(bindingId).getState());
        for (int attempt = 1; attempt <= 3; attempt++) {
            BrokerProcess.Reply warm = warm(probe, "warm #" + attempt, broker,
                    HARNESS);
            log(probe, "  binding " + rig.bindings.findById(bindingId)
                    .getState() + "; call-1 "
                    + rig.execution(execution).getState());
            if (warm.ok() && !bindingId.equals(((JSONObject) warm.value())
                    .getString("bindingId"))) {
                log(probe, "  REPLACEMENT generation started");
                break;
            }
            Thread.sleep(500);
        }
        reply(probe, "reconcile call-1", broker.reconcile(HARNESS, SESSION,
                execution));
        reply(probe, "get call-1", broker.get(HARNESS, SESSION, execution));
        reply(probe, "retry key-1", broker.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "perl escape.pl;"
                        + " echo start >> marker; sleep 30;"
                        + " echo end >> marker")));
        reply(probe, "release", broker.release(HARNESS, SESSION));
        int before = rig.marker("escaped").size();
        Thread.sleep(2_000);
        log(probe, "escaped writer still writing: " + before + " -> "
                + rig.marker("escaped").size() + "; marker "
                + rig.marker("marker") + "; workers="
                + broker.workers().size());
    }

    /** C1: round-1 P2/P2b on this head (stale Broker after LOST). */
    @Test
    void c1StaleBrokerAfterLoss() throws Exception {
        String probe = "c1-stale-broker";
        BrokerProcess first = rig.broker("first", rig.proxy(),
                FaultGateRig.Provisioner.RECOVERABLE);
        warm(probe, "first warm (setup)", first, HARNESS);
        first.acquire(HARNESS, SESSION).requireOk();
        String execution = first.create(HARNESS, SESSION, "key-1",
                FaultGateRig.shell("call-1", "echo start >> marker;"
                        + " sleep 20; echo end >> marker")).object()
                .getString("executionCallId");
        rig.awaitMarker("marker", List.of("start"));
        String bindingId = rig.execution(execution).getBindingId();
        List<ProcessHandle> workers = first.workers();
        first.pause();
        workers.forEach(w -> ProcessTrees.kill(w, FaultGateRig.WAIT));
        BrokerProcess second = rig.broker("second", rig.proxy(),
                FaultGateRig.Provisioner.RECOVERABLE);
        warm(probe, "second warm", second, HARNESS);
        log(probe, "binding " + rig.bindings.findById(bindingId).getState()
                + "; call-1 " + rig.execution(execution).getState());
        first.resume();
        reply(probe, "first (stale) release", first.release(HARNESS, SESSION));
        log(probe, "  binding " + rig.bindings.findById(bindingId).getState());
        reply(probe, "first (stale) create key-2", first.create(HARNESS,
                SESSION, "key-2", FaultGateRig.shell("call-2",
                        "echo late >> marker")));
        log(probe, "  binding " + rig.bindings.findById(bindingId).getState());
        warm(probe, "second warm again", second, HARNESS);
        log(probe, "binding " + rig.bindings.findById(bindingId).getState()
                + "; call-1 " + rig.execution(execution).getState()
                + "; marker " + rig.marker("marker"));
    }

    /**
     * U1: upgrade. The old Broker (OLD_CP) runs on an old-schema database and
     * handles one worker crash the old way (FAILED + replacement). Then the
     * new schema initializer runs and new Brokers start on the same data.
     */
    @Test
    void u1UpgradeWithAHistoricalFailedRow() throws Exception {
        String probe = "u1-upgrade";
        String oldCp = System.getenv("OLD_CP");
        String oldSchema = System.getenv("OLD_SCHEMA");
        String oldCli = System.getenv("OLD_CLI");
        if (oldCp == null || oldSchema == null || oldCli == null) {
            log(probe, "skipped: OLD_CP/OLD_SCHEMA/OLD_CLI not set");
            return;
        }
        Path root = Files.createDirectories(rig.root.resolve("upgrade"));
        Server server = Server.createTcpServer("-tcpPort", "0",
                "-ifNotExists", "-baseDir", root.resolve("db").toString())
                .start();
        extras.add(server::stop);
        String url = "jdbc:h2:tcp://127.0.0.1:" + server.getPort()
                + "/broker;MODE=MySQL;DATABASE_TO_LOWER=TRUE";
        try (Connection connection = DriverManager.getConnection(url, "sa", "");
                Statement statement = connection.createStatement()) {
            for (String sql : Files.readString(Path.of(oldSchema)).split(";")) {
                if (!sql.trim().isEmpty()) {
                    statement.execute(sql.trim());
                }
            }
            for (String table : List.of("qwen_runtime_binding_slot",
                    "qwen_runtime_binding")) {
                if (!hasColumn(statement, table, "storage_id")) {
                    statement.execute("ALTER TABLE " + table
                            + " ADD COLUMN storage_id VARCHAR(256)");
                }
            }
        }
        log(probe, "old schema applied (baseline schema.sql)");
        Path wsA = Files.createDirectories(root.resolve("workspace-a"))
                .toRealPath();
        FaultProxy oldProxy = rig.proxy();
        OldBroker old = new OldBroker(oldCp, config(root, "old", url,
                "tenant-a", "workspace-a", wsA, "workspace", oldProxy, oldCli),
                root.resolve("old.log"), rig.root.resolve("home"));
        extras.add(old);
        log(probe, "old warm -> " + old.call("warm", Map.of("harness",
                HARNESS)));
        log(probe, "old acquire -> " + old.call("acquire", Map.of("harness",
                HARNESS, "runtimeSession", SESSION)));
        Map<String, Object> create = new LinkedHashMap<>();
        create.put("harness", HARNESS);
        create.put("runtimeSession", SESSION);
        create.put("key", "key-1");
        create.put("reference", FaultGateRig.shell("call-1",
                "echo start >> marker; sleep 20"));
        log(probe, "old create -> " + old.call("create", create));
        Thread.sleep(1_500);
        List<ProcessHandle> workers = old.workers();
        workers.forEach(w -> ProcessTrees.kill(w, FaultGateRig.WAIT));
        log(probe, "old worker tree SIGKILLed " + workers.stream()
                .map(ProcessHandle::pid).toList());
        Thread.sleep(1_000);
        log(probe, "old warm #1 -> " + old.call("warm", Map.of("harness",
                HARNESS)));
        log(probe, "old warm #2 -> " + old.call("warm", Map.of("harness",
                HARNESS)));
        old.close();
        log(probe, "rows before upgrade: " + bindingRows(url));

        javax.sql.DataSource dataSource = new DriverManagerDataSource(url,
                "sa", "");
        JdbcRuntimeBrokerSchema.initialize(dataSource);
        log(probe, "new JdbcRuntimeBrokerSchema.initialize() ok; rows: "
                + bindingRows(url));
        try (Connection connection = DriverManager.getConnection(url, "sa", "");
                Statement statement = connection.createStatement();
                ResultSet inventory = statement.executeQuery(
                        "SELECT tenant_id, COUNT(*) AS failed_bindings"
                                + " FROM qwen_runtime_binding"
                                + " WHERE binding_state = 'FAILED'"
                                + " AND provision_seed_ciphertext IS NOT NULL"
                                + " GROUP BY tenant_id")) {
            List<String> found = new ArrayList<>();
            while (inventory.next()) {
                found.add(inventory.getString(1) + "=" + inventory.getLong(2));
            }
            log(probe, "README inventory query -> " + found);
        }

        Path wsB = Files.createDirectories(root.resolve("workspace-b"))
                .toRealPath();
        BrokerProcess nb = BrokerProcess.start("new-b", writeConfig(root,
                "new-b", config(root, "new-b", url, "tenant-a",
                        "workspace-b", wsB, "workspace", rig.proxy(), null)),
                root.resolve("new-b.log"), rig.root.resolve("home"));
        extras.add(nb);
        warm(probe, "new Broker, tenant-a / workspace-b (new placement)", nb,
                "harness-b");
        Path wsC = Files.createDirectories(root.resolve("workspace-c"))
                .toRealPath();
        BrokerProcess nc = BrokerProcess.start("new-c", writeConfig(root,
                "new-c", config(root, "new-c", url, "tenant-b",
                        "workspace-c", wsC, "workspace", rig.proxy(), null)),
                root.resolve("new-c.log"), rig.root.resolve("home"));
        extras.add(nc);
        warm(probe, "new Broker, tenant-b / workspace-c (control)", nc,
                "harness-c");
    }

    // ---- helpers ----

    private BrokerProcess scoped(String name, String tenant, String workspace,
            Path cwd, String isolation, FaultProxy proxy) throws Exception {
        String template;
        try (var files = Files.list(rig.root)) {
            template = files.filter(p -> p.toString().endsWith(".json"))
                    .findFirst().map(p -> p.toString()).orElse(null);
        }
        String url;
        if (template != null) {
            url = JSON.parseObject(Files.readString(Path.of(template)))
                    .getString("jdbcUrl");
        } else {
            BrokerProcess probe = rig.broker("template", rig.proxy(),
                    FaultGateRig.Provisioner.LOCAL_PROCESS);
            probe.close();
            try (var files = Files.list(rig.root)) {
                url = JSON.parseObject(Files.readString(files.filter(
                        p -> p.toString().endsWith(".json")).findFirst()
                        .orElseThrow())).getString("jdbcUrl");
            }
        }
        BrokerProcess broker = BrokerProcess.start(name, writeConfig(rig.root,
                name, config(rig.root, name, url, tenant, workspace, cwd,
                        isolation, proxy, null)), rig.root.resolve(name
                                + ".log"), rig.root.resolve("home"));
        extras.add(broker);
        return broker;
    }

    private static Map<String, Object> config(Path root, String name,
            String url, String tenant, String workspace, Path cwd,
            String isolation, FaultProxy proxy, String cli) {
        Map<String, Object> scope = new LinkedHashMap<>();
        scope.put("tenantId", tenant);
        scope.put("workspaceId", workspace);
        scope.put("workspaceGeneration", "1");
        scope.put("canonicalCwd", cwd.toString());
        scope.put("capabilityDigest", "sha256:" + "a".repeat(64));
        scope.put("isolationClass", isolation);
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("jdbcUrl", url);
        config.put("secretKey", SECRET_KEY);
        config.put("ownerId", name + "-" + System.nanoTime());
        config.put("node", "node");
        config.put("cli", cli != null ? cli
                : System.getProperty(FaultGateRig.CLI_PROPERTY));
        config.put("stateDir", root.toString());
        config.put("records", null);
        config.put("proxyPort", proxy.port());
        config.put("operationLeaseMillis", FaultGateRig.OPERATION_LEASE
                .toMillis());
        config.put("dispatchLeaseMillis", FaultGateRig.DISPATCH_LEASE
                .toMillis());
        config.put("requestTimeoutMillis", FaultGateRig.REQUEST_TIMEOUT
                .toMillis());
        config.put("scope", scope);
        return config;
    }

    private static Path writeConfig(Path root, String name,
            Map<String, Object> config) throws IOException {
        Path file = root.resolve(name + "-probe.json");
        Files.writeString(file, JSON.toJSONString(config));
        return file;
    }

    private static boolean hasColumn(Statement statement, String table,
            String column) throws java.sql.SQLException {
        try (ResultSet result = statement.executeQuery("SELECT * FROM "
                + table + " WHERE 1 = 0")) {
            for (int i = 1; i <= result.getMetaData().getColumnCount(); i++) {
                if (column.equalsIgnoreCase(result.getMetaData()
                        .getColumnName(i))) {
                    return true;
                }
            }
        }
        return false;
    }

    private static String bindingRows(String url) throws Exception {
        List<String> rows = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection(url, "sa", "");
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("SELECT tenant_id,"
                        + " runtime_generation, binding_state,"
                        + " provision_seed_ciphertext IS NOT NULL AS seeded FROM"
                        + " qwen_runtime_binding ORDER BY runtime_generation")) {
            while (result.next()) {
                rows.add(result.getString(1) + "/gen" + result.getLong(2)
                        + "/" + result.getString(3) + "/seed="
                        + result.getBoolean(4));
            }
        } catch (java.sql.SQLException failure) {
            return "(query failed: " + failure.getMessage() + ")";
        }
        return rows.toString();
    }

    private BrokerProcess.Reply warm(String probe, String what,
            BrokerProcess broker, String harness) {
        long start = System.nanoTime();
        BrokerProcess.Reply reply = broker.warm(harness);
        log(probe, what + " -> " + describe(reply) + " ("
                + (System.nanoTime() - start) / 1_000_000 + " ms)");
        return reply;
    }

    private void reply(String probe, String what, BrokerProcess.Reply reply) {
        log(probe, what + " -> " + describe(reply));
    }

    private static String describe(BrokerProcess.Reply reply) {
        if (reply.ok()) {
            Object value = reply.value();
            if (value instanceof JSONObject object) {
                JSONObject copy = new JSONObject(object);
                if (copy.containsKey("bindingId")) {
                    copy.put("bindingId", id(copy.getString("bindingId")));
                }
                if (copy.containsKey("executionCallId")) {
                    copy.put("executionCallId",
                            id(copy.getString("executionCallId")));
                }
                copy.remove("dispatchOwner");
                copy.remove("record");
                return "ok " + copy.toJSONString();
            }
            return "ok " + JSON.toJSONString(value);
        }
        return reply.status() + " " + reply.code() + " retryable="
                + reply.retryable();
    }

    private void state(String probe, String bindingId, ProcessHandle worker) {
        RuntimeBindingRecord binding = rig.bindings.findById(bindingId);
        log(probe, "  binding " + id(bindingId) + " state "
                + binding.getState() + "; original worker " + worker.pid()
                + " alive=" + worker.isAlive());
    }

    private long awaitPid(Path file) throws InterruptedException {
        String text = FaultGateRig.await(() -> {
            try {
                return Files.exists(file) ? Files.readString(file).trim() : "";
            } catch (IOException exception) {
                return "";
            }
        }, value -> !value.isEmpty(), file.toString());
        long pid = Long.parseLong(text);
        escapedPids.add(pid);
        return pid;
    }

    private static String id(String value) {
        return value == null ? "null" : value.substring(0,
                Math.min(8, value.length()));
    }

    private static synchronized void log(String probe, String line) {
        String text = System.currentTimeMillis() + " " + line + "\n";
        System.err.print("[" + probe + "] " + text);
        try {
            Files.writeString(OUT.resolve(probe + ".log"), text,
                    StandardCharsets.UTF_8, StandardOpenOption.CREATE,
                    StandardOpenOption.APPEND);
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }

    /** The baseline FaultGateBroker on the baseline classpath. */
    private static final class OldBroker implements AutoCloseable {
        private final Process process;
        private final BufferedWriter input;
        private final BlockingQueue<String> output = new LinkedBlockingQueue<>();
        private long nextId;

        OldBroker(String classpath, Map<String, Object> config, Path log,
                Path home) throws Exception {
            Path file = log.resolveSibling("old-config.json");
            Files.writeString(file, JSON.toJSONString(config));
            ProcessBuilder builder = new ProcessBuilder(Path.of(
                    System.getProperty("java.home"), "bin", "java").toString(),
                    "-cp", classpath,
                    "com.alibaba.qwen.code.runtimebroker.FaultGateBroker",
                    file.toString()).redirectError(log.toFile());
            builder.environment().put("HOME", home.toString());
            process = builder.start();
            input = new BufferedWriter(new OutputStreamWriter(
                    process.getOutputStream(), StandardCharsets.UTF_8));
            Thread reader = new Thread(() -> {
                try (BufferedReader lines = new BufferedReader(
                        new InputStreamReader(process.getInputStream(),
                                StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = lines.readLine()) != null) {
                        output.add(line);
                    }
                } catch (IOException ignored) {
                    // gone
                }
            });
            reader.setDaemon(true);
            reader.start();
            String ready = output.poll(60, TimeUnit.SECONDS);
            assertEquals(true, ready != null && JSON.parseObject(ready)
                    .getBooleanValue("ready"), "old Broker did not start");
        }

        synchronized String call(String op, Map<String, Object> args)
                throws Exception {
            Map<String, Object> command = new LinkedHashMap<>(args);
            command.put("id", ++nextId);
            command.put("op", op);
            input.write(JSON.toJSONString(command));
            input.newLine();
            input.flush();
            String line = output.poll(120, TimeUnit.SECONDS);
            if (line == null) {
                return "(no reply)";
            }
            JSONObject reply = JSON.parseObject(line);
            if (reply.getBooleanValue("ok")) {
                JSONObject value = reply.getJSONObject("value");
                if (value != null && value.containsKey("bindingId")) {
                    value.put("bindingId", id(value.getString("bindingId")));
                }
                if (value != null) {
                    value.remove("dispatchOwner");
                    value.remove("executionCallId");
                    value.remove("result");
                }
                return "ok " + (value == null ? reply.get("value") : value);
            }
            return reply.getIntValue("status") + " " + reply.getString("code")
                    + " retryable=" + reply.getBooleanValue("retryable");
        }

        List<ProcessHandle> workers() {
            return process.children().filter(ProcessHandle::isAlive).toList();
        }

        @Override
        public void close() throws Exception {
            if (!process.isAlive()) {
                return;
            }
            List<ProcessHandle> tree = process.descendants().toList();
            input.close();
            if (!process.waitFor(15, TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
            ProcessTrees.kill(tree, FaultGateRig.WAIT);
        }
    }
}
