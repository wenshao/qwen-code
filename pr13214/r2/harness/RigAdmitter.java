package com.alibaba.qwen.code.runtimebroker;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import javax.sql.DataSource;

/**
 * PR 13214 rig: "Broker process B". A separate JVM over the same MySQL that
 * runs the production admission transaction
 * (JdbcRuntimeBindingRepository.admitExecution, exactly what
 * RuntimeBrokerService.createExecution commits) and reads back session /
 * execution state for the race classifier.
 */
public final class RigAdmitter {
    private RigAdmitter() {
    }

    public static void main(String[] args) throws Exception {
        JSONObject config = JSON.parseObject(Files.readString(Path.of(args[0])));
        DataSource dataSource = new DriverManagerDataSource(config.getString("jdbcUrl"),
                config.getString("user"), config.getString("password"));
        JdbcRuntimeBindingRepository bindings = new JdbcRuntimeBindingRepository(dataSource,
                AesGcmSecretProtector.fromBase64("rig", config.getString("secretKey")));
        JdbcRuntimeSessionRepository sessions = new JdbcRuntimeSessionRepository(dataSource);
        JdbcToolExecutionRepository executions = new JdbcToolExecutionRepository(dataSource);
        JSONObject s = config.getJSONObject("scope");
        RuntimeScope scope = new RuntimeScope(s.getString("tenantId"), s.getString("workspaceId"),
                s.getString("workspaceGeneration"), s.getString("canonicalCwd"),
                s.getString("capabilityDigest"), s.getString("isolationClass"));
        HttpServer server = HttpServer.create(new InetSocketAddress(
                InetAddress.getLoopbackAddress(), config.getIntValue("httpPort")), 64);
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.createContext("/admit", exchange -> {
            JSONObject body = JSON.parseObject(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            Map<String, Object> reply = new LinkedHashMap<>();
            long started = System.nanoTime();
            try {
                String sessionId = body.getString("runtimeSession");
                String callId = body.getString("callId");
                String digest = "sha256:" + "b".repeat(64);
                Map<String, Object> reference = Map.of("sessionId", sessionId, "promptId", "turn-b",
                        "callId", callId, "argsDigest", digest);
                ToolExecutionRecord admitted = bindings.admitExecution(sessions, executions,
                        ToolExecutionRecord.prepared("exec-" + UUID.randomUUID(), "key-" + callId,
                                body.getString("bindingId"), body.getLongValue("generation"),
                                body.getString("harness"), sessionId, "turn-b", callId, digest, reference));
                reply.put("ok", true);
                reply.put("executionCallId", admitted.getExecutionCallId());
                reply.put("state", admitted.getState().name());
            } catch (RuntimeBrokerException failure) {
                reply.put("ok", false);
                reply.put("status", failure.getStatusCode());
                reply.put("code", failure.getCode());
            } catch (RuntimeException failure) {
                reply.put("ok", false);
                reply.put("code", failure.getClass().getName() + ": " + failure.getMessage());
            }
            reply.put("micros", (System.nanoTime() - started) / 1000);
            send(exchange, reply);
        });
        server.createContext("/inspect", exchange -> {
            JSONObject body = JSON.parseObject(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            Map<String, Object> reply = new LinkedHashMap<>();
            String sessionId = body.getString("runtimeSession");
            RuntimeSessionRecord record = sessions.findById(scope, sessionId);
            reply.put("sessionState", record == null ? null : record.getState().name());
            reply.put("sessionVersion", record == null ? null : record.getVersion());
            reply.put("hasActive", executions.hasActiveByRuntimeSession(body.getString("bindingId"),
                    body.getLongValue("generation"), sessionId));
            send(exchange, reply);
        });
        server.start();
        System.out.println(JSON.toJSONString(Map.of("ready", true)));
    }

    private static void send(HttpExchange exchange, Map<String, Object> reply) throws IOException {
        byte[] bytes = JSON.toJSONString(reply).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream body = exchange.getResponseBody()) {
            body.write(bytes);
        }
    }
}
