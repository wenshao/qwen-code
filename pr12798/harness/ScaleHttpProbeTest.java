package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

/** Real HTTP server + service + JDBC repositories; the transport is a
 * programmatic integration returning results the probe chooses. */
class ScaleHttpProbeTest {
    private static final Map<String, Object> RESULTS = new ConcurrentHashMap<>();
    private static final Map<String, Object> RECEIVED = new ConcurrentHashMap<>();

    @Test
    void httpStack() throws Exception {
        DataSource dataSource = ScaleProbeSupport.dataSource();
        JdbcRuntimeBrokerSchema.initialize(dataSource);
        String run = UUID.randomUUID().toString().substring(0, 8);
        RuntimeScope scope = new RuntimeScope("tenant", "workspace",
                "generation", "/workspace", "capability", "workspace");
        RuntimeBrokerService service = new RuntimeBrokerService(
                id -> CompletableFuture.completedFuture(scope),
                new StaticRuntimeProvisioner(new RuntimeLease("instance",
                        URI.create("http://127.0.0.1:1234"), "token", "lease", 1)),
                new ScriptedTransport(),
                new JdbcRuntimeBindingRepository(dataSource,
                        new AesGcmSecretProtector("probe", new byte[32])),
                new JdbcRuntimeSessionRepository(dataSource),
                new JdbcToolExecutionRepository(dataSource),
                "broker-" + run, Duration.ofMinutes(1), Duration.ofMinutes(1));
        RuntimeBrokerHttpServer server = new RuntimeBrokerHttpServer(
                new InetSocketAddress("127.0.0.1", 0), "secret", service);
        server.start();
        HttpClient client = HttpClient.newHttpClient();
        String harness = "harness-" + run;
        String runtime = "runtime-" + run;
        try {
            HttpResponse<String> acquired = post(client, server,
                    "/tool-sessions:acquire", "{\"protocolVersion\":1,"
                    + "\"requestId\":\"acquire\",\"harnessSessionId\":\""
                    + harness + "\",\"runtimeSessionId\":\"" + runtime
                    + "\",\"turnKind\":\"bootstrap\"}");
            ScaleProbeSupport.emit("http", "setup", "acquire",
                    acquired.statusCode() + " " + shorten(acquired.body()));
            int index = 0;
            // Programmatic transport returns a result containing the value.
            for (Map.Entry<String, BigDecimal> entry
                    : ScaleProbeSupport.cases().entrySet()) {
                index++;
                String digest = "result-" + index + "-" + run;
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("executionStatus", "success");
                result.put("value", entry.getValue());
                RESULTS.put(digest, result);
                String key = "key-" + digest;
                String body = executionBody(harness, runtime, key, digest,
                        null);
                HttpResponse<String> created = post(client, server,
                        "/executions", body);
                String id = executionId(created.body());
                ScaleProbeSupport.emit("http-result", entry.getKey(),
                        "1 POST /executions", created.statusCode() + " "
                                + shorten(created.body()));
                Thread.sleep(300);
                if (id != null) {
                    HttpResponse<String> read = get(client, server, id,
                            harness, runtime);
                    ScaleProbeSupport.emit("http-result", entry.getKey(),
                            "2 GET /executions/{id}", read.statusCode() + " "
                                    + describeGet(read.body(), entry.getValue()));
                }
                HttpResponse<String> retried = post(client, server,
                        "/executions", body);
                ScaleProbeSupport.emit("http-result", entry.getKey(),
                        "3 retry POST same idempotencyKey",
                        retried.statusCode() + " " + shorten(retried.body()));
            }
            // Programmatic caller: same request twice with one idempotency key.
            for (String literal : new String[] {"1E-32768", "0." + "1".repeat(2049)}) {
                index++;
                String digest = "programmatic-" + index + "-" + run;
                RESULTS.put(digest, Map.of("executionStatus", "success"));
                String caseName = literal.length() > 20 ? "0.1{2049}" : literal;
                for (int attempt = 1; attempt <= 2; attempt++) {
                    Map<String, Object> reference = new LinkedHashMap<>();
                    reference.put("sessionId", runtime);
                    reference.put("promptId", "turn-" + digest);
                    reference.put("callId", "call-" + digest);
                    reference.put("argsDigest", digest);
                    reference.put("value", new BigDecimal(literal));
                    String outcome;
                    try {
                        ToolExecutionRecord record = service.createExecution(
                                harness, runtime, "key-" + digest, reference)
                                .toCompletableFuture().join();
                        outcome = "OK state=" + record.getState();
                    } catch (RuntimeException error) {
                        Throwable cause = error.getCause() == null ? error : error.getCause();
                        outcome = cause instanceof RuntimeBrokerException broker
                                ? "RuntimeBrokerException " + broker.getStatusCode()
                                        + " " + broker.getCode()
                                : ScaleProbeSupport.failure(cause);
                    }
                    ScaleProbeSupport.emit("programmatic", caseName,
                            attempt + " service.createExecution (same key+request)",
                            outcome);
                    Thread.sleep(200);
                }
            }
            // Raw client JSON literal inside the reference.
            Map<String, String> literals = new LinkedHashMap<>();
            literals.put("0.1{2049} (p=2049,s=2049)", "0." + "1".repeat(2049));
            literals.put("0.0{2048}7 (p=1,s=2049)", "0." + "0".repeat(2048) + "7");
            literals.put("0.0{32767}1 (=1E-32768)", "0." + "0".repeat(32767) + "1");
            for (Map.Entry<String, String> literal : literals.entrySet()) {
                index++;
                String digest = "reference-" + index + "-" + run;
                RESULTS.put(digest, Map.of("executionStatus", "success"));
                String body = executionBody(harness, runtime,
                        "key-" + digest, digest, literal.getValue());
                HttpResponse<String> created = post(client, server,
                        "/executions", body);
                ScaleProbeSupport.emit("http-reference", literal.getKey(),
                        "1 POST /executions", created.statusCode() + " "
                                + shorten(created.body()));
                Thread.sleep(300);
                Object seen = RECEIVED.get(digest);
                ScaleProbeSupport.emit("http-reference", literal.getKey(),
                        "2 value the Runtime received",
                        seen == null ? "(not dispatched)"
                                : describeValue(seen, new BigDecimal(literal.getValue())));
                String id = executionId(created.body());
                if (id != null) {
                    HttpResponse<String> read = get(client, server, id,
                            harness, runtime);
                    ScaleProbeSupport.emit("http-reference", literal.getKey(),
                            "3 GET /executions/{id}", read.statusCode() + " "
                                    + shorten(read.body()));
                }
            }
        } finally {
            server.close();
            client.close();
        }
    }

    private static String executionBody(String harness, String runtime,
            String key, String digest, String literal) {
        String reference = "{\"sessionId\":\"" + runtime + "\",\"promptId\":\"turn-"
                + digest + "\",\"callId\":\"call-" + digest
                + "\",\"argsDigest\":\"" + digest + "\""
                + (literal == null ? "" : ",\"value\":" + literal) + "}";
        return "{\"protocolVersion\":1,\"requestId\":\"req-" + digest
                + "\",\"idempotencyKey\":\"" + key + "\",\"harnessSessionId\":\""
                + harness + "\",\"runtimeSessionId\":\"" + runtime
                + "\",\"turnId\":\"turn-" + digest + "\",\"toolCallId\":\"call-"
                + digest + "\",\"requestDigest\":\"" + digest
                + "\",\"reference\":" + reference + "}";
    }

    private static String executionId(String body) {
        java.util.regex.Matcher matcher = java.util.regex.Pattern
                .compile("\"executionCallId\":\"([^\"]+)\"").matcher(body);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static String describeGet(String body, BigDecimal expected) {
        java.util.regex.Matcher state = java.util.regex.Pattern
                .compile("\"state\":\"(\\w+)\"").matcher(body);
        java.util.regex.Matcher value = java.util.regex.Pattern
                .compile("\"value\":([-+0-9.Ee]+)").matcher(body);
        if (state.find() && value.find()) {
            String literal = value.group(1);
            String verdict;
            try {
                verdict = ScaleProbeSupport.describe(new BigDecimal(literal), expected);
            } catch (RuntimeException error) {
                verdict = "unparsed";
            }
            return "state=" + state.group(1) + " result.value="
                    + (literal.length() > 20 ? literal.substring(0, 20) + "..." : literal)
                    + " (" + verdict + ")";
        }
        try {
            Map<?, ?> status = (Map<?, ?>) JSON.parseObject(body).get("status");
            if (status != null && status.get("result") instanceof Map<?, ?> result) {
                return "state=" + status.get("state") + " result.value "
                        + describeValue(result.get("value"), expected);
            }
        } catch (RuntimeException ignored) {
            // fall through to the raw body
        }
        return shorten(body);
    }

    private static String describeValue(Object value, BigDecimal expected) {
        return ScaleProbeSupport.describe(value instanceof String text
                ? new BigDecimal(text) : value, expected);
    }

    private static String shorten(String body) {
        String flat = body.replaceAll("\\s+", " ");
        return flat.length() > 110 ? flat.substring(0, 110) + "..." : flat;
    }

    private static URI uri(RuntimeBrokerHttpServer server, String path) {
        return server.getBaseUri().resolve(
                RuntimeBrokerHttpServer.ROUTE_PREFIX + path);
    }

    private static HttpResponse<String> post(HttpClient client,
            RuntimeBrokerHttpServer server, String path, String body)
            throws Exception {
        return client.send(HttpRequest.newBuilder(uri(server, path))
                .header("Authorization", "Bearer secret")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private static HttpResponse<String> get(HttpClient client,
            RuntimeBrokerHttpServer server, String id, String harness,
            String runtime) throws Exception {
        return client.send(HttpRequest.newBuilder(uri(server, "/executions/"
                + id + "?requestId=read&harnessSessionId=" + harness
                + "&runtimeSessionId=" + runtime))
                .header("Authorization", "Bearer secret").GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private static final class ScriptedTransport implements RuntimeTransport {
        @Override
        public CompletionStage<Void> acquire(RuntimeLease lease,
                RuntimeSession session) {
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<Object> control(RuntimeLease lease,
                RuntimeSession session, Map<String, Object> operation) {
            return CompletableFuture.completedFuture(Map.of());
        }

        @Override
        public CompletionStage<Map<String, Object>> execute(RuntimeLease lease,
                RuntimeSession session, Map<String, Object> reference) {
            String digest = String.valueOf(reference.get("argsDigest"));
            if (reference.containsKey("value")) {
                RECEIVED.put(digest, reference.get("value"));
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> result = (Map<String, Object>) RESULTS.get(digest);
            return CompletableFuture.completedFuture(result);
        }

        @Override
        public CompletionStage<Map<String, Object>> cancel(RuntimeLease lease,
                RuntimeSession session, Map<String, Object> reference) {
            return CompletableFuture.completedFuture(Map.of("state", "unknown"));
        }

        @Override
        public CompletionStage<Boolean> release(RuntimeLease lease,
                RuntimeSession session) {
            return CompletableFuture.completedFuture(true);
        }
    }
}
