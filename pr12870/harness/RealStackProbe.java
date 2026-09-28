package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpServer;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;

/**
 * Real-stack probe: production RuntimeBrokerHttpServer + RuntimeBrokerService
 * + JDBC repositories on a real MySQL/MariaDB, with two Runtime paths:
 * (a) an embedder RuntimeTransport that returns Java BigDecimal/BigInteger
 *     values directly (the live path named by #12859), and
 * (b) the production HttpRuntimeTransport (v2 wire) talking to a fake worker
 *     HTTP server that answers with a crafted numeric literal.
 * Every case runs in its own Runtime Session and is observed four ways:
 * the Broker HTTP answer, the raw SQL row, a GET through the Broker, and a
 * fresh JdbcToolExecutionRepository (a Broker restart) reading the row.
 */
public final class RealStackProbe {
    static final Map<String, Object> EMBEDDER_VALUES = new LinkedHashMap<>();
    static final Map<String, String> WORKER_LITERALS = new LinkedHashMap<>();

    public static void main(String[] args) throws Exception {
        String arm = args[0];
        String adminUrl = args[1]; // jdbc:mysql://127.0.0.1:port/
        String db = args[2];
        String label = args[3];
        try (Connection admin = DriverManager.getConnection(adminUrl, "root", "root");
                Statement statement = admin.createStatement()) {
            statement.execute("DROP DATABASE IF EXISTS " + db);
            statement.execute("CREATE DATABASE " + db
                    + " CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
        }
        String url = adminUrl + db + "?useSSL=false&allowPublicKeyRetrieval=true";
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url, "root", "root");
        JdbcRuntimeBrokerSchema.initialize(dataSource);
        String version;
        try (Connection c = dataSource.getConnection(); Statement s = c.createStatement();
                ResultSet r = s.executeQuery("SELECT VERSION()")) {
            r.next();
            version = r.getString(1);
        }

        EMBEDDER_VALUES.put("e-1E100000", new BigDecimal("1E+100000"));
        EMBEDDER_VALUES.put("e-minscale", new BigDecimal(BigInteger.ONE, Integer.MIN_VALUE));
        EMBEDDER_VALUES.put("e-1E2049", new BigDecimal("1E+2049"));
        EMBEDDER_VALUES.put("e-1E2048", new BigDecimal("1E+2048"));
        EMBEDDER_VALUES.put("e-bigint-10001d", BigInteger.TEN.pow(10000));
        EMBEDDER_VALUES.put("e-prec7953-s-2048", new BigDecimal(new BigInteger("9".repeat(7953)), -2048));
        WORKER_LITERALS.put("w-1E100000", "1E+100000");
        WORKER_LITERALS.put("w-9x8000E2047", "9".repeat(8000) + "E+2047");
        WORKER_LITERALS.put("w-1E400", "1E+400");

        HttpServer worker = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        worker.createContext("/", exchange -> {
            byte[] request = exchange.getRequestBody().readAllBytes();
            JSONObject body = JSON.parseObject(new String(request, StandardCharsets.UTF_8));
            String path = exchange.getRequestURI().getPath();
            String callId = body.getJSONObject("reference").getString("callId");
            String response;
            if (path.endsWith("/v2/execute")) {
                String literal = WORKER_LITERALS.getOrDefault(callId, "1");
                response = "{\"protocolVersion\":2,\"state\":\"settled\",\"result\":{"
                        + "\"executionStatus\":\"success\",\"responseParts\":[{\"n\":"
                        + literal + "}]}}";
            } else if (path.endsWith("/v2/status")) {
                String literal = WORKER_LITERALS.getOrDefault(callId, "1");
                response = "{\"protocolVersion\":2,\"state\":\"settled\",\"result\":{"
                        + "\"executionStatus\":\"success\",\"responseParts\":[{\"n\":"
                        + literal + "}]}}";
            } else {
                response = "{\"protocolVersion\":2,\"state\":\"unknown\"}";
            }
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Cache-Control", "no-store");
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        worker.start();
        URI workerUri = URI.create("http://127.0.0.1:" + worker.getAddress().getPort());

        HttpRuntimeTransport production = new HttpRuntimeTransport();
        RuntimeTransport router = new RuntimeTransport() {
            @Override
            public CompletionStage<Void> acquire(RuntimeLease lease, RuntimeSession session) {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public CompletionStage<Object> control(RuntimeLease lease, RuntimeSession session,
                    Map<String, Object> operation) {
                return CompletableFuture.completedFuture(Map.of());
            }

            @Override
            public CompletionStage<Map<String, Object>> execute(RuntimeLease lease,
                    RuntimeSession session, Map<String, Object> reference) {
                String callId = (String) reference.get("callId");
                if (callId.startsWith("w-")) {
                    return production.execute(lease, session, reference);
                }
                Object value = EMBEDDER_VALUES.get(callId);
                Map<String, Object> part = new LinkedHashMap<>();
                part.put("n", value == null ? 1 : value);
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("executionStatus", "success");
                result.put("responseParts", List.of(part));
                return CompletableFuture.completedFuture(result);
            }

            @Override
            public CompletionStage<Map<String, Object>> status(RuntimeLease lease,
                    RuntimeSession session, Map<String, Object> reference, long afterSequence) {
                String callId = (String) reference.get("callId");
                if (callId.startsWith("w-")) {
                    return production.status(lease, session, reference, afterSequence);
                }
                Object value = EMBEDDER_VALUES.get(callId);
                Map<String, Object> part = new LinkedHashMap<>();
                part.put("n", value == null ? 1 : value);
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("executionStatus", "success");
                result.put("responseParts", List.of(part));
                Map<String, Object> status = new LinkedHashMap<>();
                status.put("state", "settled");
                status.put("result", result);
                return CompletableFuture.completedFuture(status);
            }

            @Override
            public CompletionStage<Map<String, Object>> cancel(RuntimeLease lease,
                    RuntimeSession session, Map<String, Object> reference) {
                return CompletableFuture.completedFuture(Map.of("state", "unknown"));
            }

            @Override
            public CompletionStage<Boolean> release(RuntimeLease lease, RuntimeSession session) {
                return CompletableFuture.completedFuture(true);
            }
        };

        RuntimeScope scope = new RuntimeScope("tenant", "workspace", "generation",
                "/workspace", "capability", "workspace");
        RuntimeBrokerService service = new RuntimeBrokerService(
                id -> CompletableFuture.completedFuture(scope),
                new StaticRuntimeProvisioner(new RuntimeLease("instance", workerUri,
                        "token", "lease", 1)),
                router,
                new JdbcRuntimeBindingRepository(dataSource, AesGcmSecretProtector.fromBase64(
                        "probe", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")),
                new JdbcRuntimeSessionRepository(dataSource),
                new JdbcToolExecutionRepository(dataSource),
                "broker-" + arm, Duration.ofMinutes(1), Duration.ofMinutes(1));
        SERVICE = service;
        RuntimeBrokerHttpServer server = new RuntimeBrokerHttpServer(
                new InetSocketAddress("127.0.0.1", 0), "secret", service);
        server.start();
        HttpClient client = HttpClient.newHttpClient();
        Broker broker = new Broker(client, server);

        System.out.println("## arm=" + arm + " db=" + label + " (" + version + ") java="
                + System.getProperty("java.version") + " broker=" + server.getBaseUri()
                + " worker=" + workerUri);
        List<Map<String, Object>> rows = new ArrayList<>();
        List<String> cases = new ArrayList<>();
        cases.addAll(EMBEDDER_VALUES.keySet());
        cases.addAll(WORKER_LITERALS.keySet());
        for (String callId : cases) {
            rows.add(runTransportCase(broker, dataSource, callId));
        }
        rows.add(runApiReferenceCase(broker, service, dataSource, "api-ref-1E100000",
                new BigDecimal("1E+100000")));
        rows.add(runApiReferenceCase(broker, service, dataSource, "api-ref-minscale",
                new BigDecimal(BigInteger.ONE, Integer.MIN_VALUE)));
        rows.add(runInboundLiteralCase(broker, dataSource));
        for (Map<String, Object> row : rows) {
            System.out.println(JSON.toJSONString(row));
        }
        server.close();
        service.close();
        worker.stop(0);
        System.exit(0);
    }

    static Map<String, Object> runTransportCase(Broker broker,
            DriverManagerDataSource dataSource, String callId) throws Exception {
        String runtime = "r-" + callId;
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("case", callId);
        row.put("path", callId.startsWith("w-") ? "HttpRuntimeTransport v2 -> fake worker"
                : "embedder RuntimeTransport");
        row.put("acquire", broker.acquire(runtime).statusCode());
        Map<String, Object> reference = new LinkedHashMap<>();
        reference.put("sessionId", runtime);
        reference.put("promptId", "turn");
        reference.put("callId", callId);
        reference.put("argsDigest", "digest");
        reference.put("toolName", "probe_tool");
        reference.put("input", Map.of());
        HttpResponse<String> created = broker.execute(runtime, callId, JSON.toJSONString(reference));
        row.put("POST /executions", summary(created));
        observe(broker, dataSource, runtime, callId, row);
        return row;
    }

    static Map<String, Object> runApiReferenceCase(Broker broker, RuntimeBrokerService service,
            DriverManagerDataSource dataSource, String callId, Object value) throws Exception {
        String runtime = "r-" + callId;
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("case", callId);
        row.put("path", "Java service API createExecution, reference.input carries " + CodecProbe.describe(value));
        row.put("acquire", broker.acquire(runtime).statusCode());
        Map<String, Object> reference = new LinkedHashMap<>();
        reference.put("sessionId", runtime);
        reference.put("promptId", "turn");
        reference.put("callId", callId);
        reference.put("argsDigest", "digest");
        reference.put("toolName", "probe_tool");
        reference.put("input", Map.of("n", value));
        try {
            ToolExecutionRecord record = service.createExecution("harness", runtime,
                    "key-" + callId, reference).toCompletableFuture().join();
            row.put("createExecution", "returned state=" + record.getState());
        } catch (RuntimeException failure) {
            Throwable cause = failure.getCause() != null ? failure.getCause() : failure;
            row.put("createExecution", "threw " + (cause instanceof RuntimeBrokerException b
                    ? b.getStatusCode() + " " + b.getCode() : cause.getClass().getSimpleName())
                    + ": " + cause.getMessage());
        }
        observe(broker, dataSource, runtime, callId, row);
        return row;
    }

    static Map<String, Object> runInboundLiteralCase(Broker broker,
            DriverManagerDataSource dataSource) throws Exception {
        String callId = "http-ref-1E100000";
        String runtime = "r-" + callId;
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("case", callId);
        row.put("path", "Broker HTTP API, reference.input literal 1E+100000");
        row.put("acquire", broker.acquire(runtime).statusCode());
        String reference = "{\"sessionId\":\"" + runtime + "\",\"promptId\":\"turn\",\"callId\":\""
                + callId + "\",\"argsDigest\":\"digest\",\"toolName\":\"probe_tool\","
                + "\"input\":{\"n\":1E+100000}}";
        HttpResponse<String> created = broker.execute(runtime, callId, reference);
        row.put("POST /executions", summary(created));
        observe(broker, dataSource, runtime, callId, row);
        return row;
    }

    static void observe(Broker broker, DriverManagerDataSource dataSource, String runtime,
            String callId, Map<String, Object> row) throws Exception {
        String executionCallId = null;
        long waitStart = System.nanoTime();
        while (System.nanoTime() - waitStart < 10_000_000_000L) {
            String state = null;
            try (Connection c = dataSource.getConnection();
                    PreparedStatement s = c.prepareStatement(
                            "SELECT execution_state FROM qwen_tool_execution WHERE idempotency_key = ?")) {
                s.setString(1, "key-" + callId);
                try (ResultSet r = s.executeQuery()) {
                    state = r.next() ? r.getString(1) : null;
                }
            }
            if (state == null || !(state.equals("EXECUTING") || state.equals("DISPATCHING")
                    || state.equals("PREPARED"))) {
                break;
            }
            Thread.sleep(100);
        }
        row.put("settle wait ms", (System.nanoTime() - waitStart) / 1_000_000);
        try (Connection c = dataSource.getConnection();
                PreparedStatement s = c.prepareStatement(
                        "SELECT execution_call_id, execution_state, LENGTH(reference_json),"
                                + " LENGTH(result_json), SUBSTRING(result_json, 1, 72)"
                                + " FROM qwen_tool_execution WHERE idempotency_key = ?")) {
            s.setString(1, "key-" + callId);
            try (ResultSet r = s.executeQuery()) {
                if (r.next()) {
                    executionCallId = r.getString(1);
                    row.put("sql", "state=" + r.getString(2) + " len(reference_json)="
                            + r.getLong(3) + " len(result_json)="
                            + (r.getObject(4) == null ? "NULL" : r.getLong(4))
                            + (r.getString(5) == null ? "" : " head=" + r.getString(5)));
                } else {
                    row.put("sql", "no row");
                }
            }
        }
        if (executionCallId != null) {
            row.put("GET /executions/{id}", summary(broker.get(runtime, executionCallId)));
            try {
                ToolExecutionRecord fresh = new JdbcToolExecutionRepository(dataSource)
                        .findByExecutionCallId(executionCallId);
                row.put("fresh repository read", "OK state=" + fresh.getState());
            } catch (RuntimeException failure) {
                row.put("fresh repository read", failure.getClass().getSimpleName() + ": "
                        + failure.getMessage());
            }
        }
        HttpResponse<String> released = broker.release(runtime);
        row.put("release", summary(released));
        if (executionCallId != null && released.statusCode() != 200) {
            try {
                ExecutionReconciliation outcome = SERVICE.reconcileExecution("harness", runtime,
                        executionCallId).toCompletableFuture().join();
                row.put("reconcile", outcome.getOutcome() + " state=" + outcome.getRecord().getState());
            } catch (RuntimeException failure) {
                Throwable cause = failure.getCause() != null ? failure.getCause() : failure;
                row.put("reconcile", "failed " + (cause instanceof RuntimeBrokerException b
                        ? b.getStatusCode() + " " + b.getCode() : cause.getClass().getSimpleName()));
            }
            row.put("release after reconcile", summary(broker.release(runtime)));
        }
    }

    static RuntimeBrokerService SERVICE;

    static String summary(HttpResponse<String> response) {
        String body = response.body();
        try {
            JSONObject json = JSON.parseObject(body);
            if (json.containsKey("code")) {
                return response.statusCode() + " " + json.getString("code");
            }
            Object state = json.containsKey("status")
                    ? json.getJSONObject("status").get("state") : null;
            if (json.containsKey("released")) {
                return response.statusCode() + " released=" + json.get("released");
            }
            if (state == null && json.containsKey("state")) {
                state = json.get("state");
            }
            if (state != null) {
                return response.statusCode() + " state=" + state;
            }
            return response.statusCode() + " "
                    + (body.length() > 120 ? body.substring(0, 120) + "..." : body);
        } catch (RuntimeException ignored) {
            return response.statusCode() + " "
                    + (body.length() > 120 ? body.substring(0, 120) + "..." : body);
        }
    }

    record Broker(HttpClient client, RuntimeBrokerHttpServer server) {
        URI uri(String path) {
            return server.getBaseUri().resolve(RuntimeBrokerHttpServer.ROUTE_PREFIX + path);
        }

        HttpResponse<String> post(String path, String body) throws Exception {
            return client.send(HttpRequest.newBuilder(uri(path))
                    .header("Authorization", "Bearer secret")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                    HttpResponse.BodyHandlers.ofString());
        }

        HttpResponse<String> acquire(String runtime) throws Exception {
            return post("/tool-sessions:acquire", "{\"protocolVersion\":1,\"requestId\":\"a-"
                    + runtime + "\",\"harnessSessionId\":\"harness\",\"runtimeSessionId\":\""
                    + runtime + "\",\"turnKind\":\"bootstrap\"}");
        }

        HttpResponse<String> execute(String runtime, String callId, String referenceJson)
                throws Exception {
            return post("/executions", "{\"protocolVersion\":1,\"requestId\":\"x-" + callId
                    + "\",\"idempotencyKey\":\"key-" + callId + "\",\"harnessSessionId\":\"harness\","
                    + "\"runtimeSessionId\":\"" + runtime + "\",\"turnId\":\"turn\",\"toolCallId\":\""
                    + callId + "\",\"requestDigest\":\"digest\",\"reference\":" + referenceJson + "}");
        }

        HttpResponse<String> get(String runtime, String executionCallId) throws Exception {
            String query = "?requestId=g&harnessSessionId=harness&runtimeSessionId="
                    + URLEncoder.encode(runtime, StandardCharsets.UTF_8);
            return client.send(HttpRequest.newBuilder(uri("/executions/" + executionCallId + query))
                    .header("Authorization", "Bearer secret").GET().build(),
                    HttpResponse.BodyHandlers.ofString());
        }

        HttpResponse<String> release(String runtime) throws Exception {
            return post("/tool-sessions/" + URLEncoder.encode(runtime, StandardCharsets.UTF_8)
                    + ":release", "{\"protocolVersion\":1,\"requestId\":\"rel-" + runtime
                    + "\",\"harnessSessionId\":\"harness\"}");
        }
    }
}
