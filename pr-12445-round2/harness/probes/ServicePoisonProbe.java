package com.alibaba.qwen.code.runtimebroker;

import java.net.URI;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.function.Supplier;
import javax.sql.DataSource;

/**
 * RuntimeBrokerService end to end over real JDBC repositories (binding, session, execution) on the given MySQL,
 * or with InMemoryToolExecutionRepository as the control arm. Only the Runtime side is faked.
 */
public class ServicePoisonProbe {
    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    static final class Transport implements RuntimeTransport {
        volatile Map<String, Object> executeResult = Map.of("executionStatus", "success");
        public CompletionStage<Void> acquire(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(null); }
        public CompletionStage<Object> control(RuntimeLease l, RuntimeSession s, Map<String, Object> o) { return CompletableFuture.completedFuture("ok"); }
        public CompletionStage<Map<String, Object>> execute(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { return CompletableFuture.completedFuture(executeResult); }
        public CompletionStage<Map<String, Object>> cancel(RuntimeLease l, RuntimeSession s, Map<String, Object> r) { return CompletableFuture.completedFuture(Map.of("state", "cancel_requested")); }
        public CompletionStage<Boolean> release(RuntimeLease l, RuntimeSession s) { return CompletableFuture.completedFuture(true); }
    }

    static String outcome(Supplier<CompletionStage<?>> call) {
        try {
            Object v = call.get().toCompletableFuture().join();
            if (v instanceof RuntimeSessionRecord session) {
                return "ok " + session.getState();
            }
            if (v instanceof ToolExecutionRecord r) {
                return "ok " + r.getState() + (r.getResult() == null ? "" : " result=" + r.getResult());
            }
            return "ok " + v;
        } catch (Throwable t) {
            Throwable c = t;
            while (c instanceof CompletionException && c.getCause() != null) c = c.getCause();
            if (c instanceof RuntimeBrokerException b) {
                String root = b.getCause() == null ? "" : " (cause " + b.getCause().getClass().getSimpleName()
                        + (b.getCause() instanceof IllegalArgumentException ? ": " + b.getCause().getMessage() : "") + ")";
                return b.getStatusCode() + " " + b.getCode() + root;
            }
            return "ESCAPES " + c.getClass().getName();
        }
    }

    static String rowId(DataSource ds, String runtimeSession) {
        if (ds == null) return "none";
        try (Connection c = ds.getConnection(); PreparedStatement s = c.prepareStatement(
                "SELECT execution_call_id FROM qwen_tool_execution WHERE runtime_session_id = ?")) {
            s.setString(1, runtimeSession);
            try (ResultSet r = s.executeQuery()) { return r.next() ? r.getString(1) : "none"; }
        } catch (Exception e) { return "none"; }
    }

    static String rowState(DataSource ds, String runtimeSession) {
        if (ds == null) return "-";
        try (Connection c = ds.getConnection(); PreparedStatement s = c.prepareStatement(
                "SELECT execution_state FROM qwen_tool_execution WHERE runtime_session_id = ?")) {
            s.setString(1, runtimeSession);
            try (ResultSet r = s.executeQuery()) { return r.next() ? r.getString(1) : "(no row)"; }
        } catch (Exception e) { return "?" + e; }
    }

    public static void main(String[] args) {
        String arm = args[0];
        String url = args.length > 1 ? args[1] : null;
        DataSource ds = url == null ? null : new DriverManagerDataSource(url, "root", "");
        if (ds != null) JdbcRuntimeBrokerSchema.initialize(ds);
        String run = UUID.randomUUID().toString().substring(0, 6);
        RuntimeScope scope = new RuntimeScope("tenant-" + run, "workspace", "generation", "/workspace", "capability", "workspace");
        Transport transport = new Transport();
        ToolExecutionRepository executions = ds == null ? new InMemoryToolExecutionRepository() : new JdbcToolExecutionRepository(ds);
        RuntimeBindingRepository bindings = ds == null ? new InMemoryRuntimeBindingRepository() : new JdbcRuntimeBindingRepository(ds);
        RuntimeSessionRepository sessions = ds == null ? new InMemoryRuntimeSessionRepository() : new JdbcRuntimeSessionRepository(ds);
        try (RuntimeBrokerService service = new RuntimeBrokerService(h -> CompletableFuture.completedFuture(scope),
                request -> CompletableFuture.completedFuture(new RuntimeLease("runtime-1", URI.create("http://127.0.0.1:4001"), "token", "lease-1", 1)),
                transport, bindings, sessions, executions, "broker-" + run, Duration.ofMinutes(1), Duration.ofMinutes(1))) {
            System.out.println("arm=" + arm);
            // S1: the Runtime returns a result whose output carries {"$ref":"@"}.
            String rs1 = "rs1-" + run;
            System.out.println("S1 acquire                     : " + outcome(() -> service.acquire("h1-" + run, rs1, "bootstrap")));
            transport.executeResult = m("executionStatus", "success", "output", m("$ref", "@"));
            Map<String, Object> ref1 = m("sessionId", rs1, "promptId", "p", "callId", "c", "argsDigest", "d");
            System.out.println("S1 createExecution             : " + outcome(() -> service.createExecution("h1-" + run, rs1, "k1-" + run, ref1)));
            System.out.println("S1   row state in DB           : " + rowState(ds, rs1));
            System.out.println("S1 createExecution (retry)     : " + outcome(() -> service.createExecution("h1-" + run, rs1, "k1-" + run, ref1)));
            // S2: the Harness reference carries a JSON Schema-style member {"$ref":"$"}.
            String rs2 = "rs2-" + run;
            transport.executeResult = Map.of("executionStatus", "success");
            System.out.println("S2 acquire                     : " + outcome(() -> service.acquire("h2-" + run, rs2, "bootstrap")));
            Map<String, Object> ref2 = m("sessionId", rs2, "promptId", "p", "callId", "c", "argsDigest", "d", "schema", m("$ref", "$"));
            System.out.println("S2 createExecution             : " + outcome(() -> service.createExecution("h2-" + run, rs2, "k2-" + run, ref2)));
            System.out.println("S2   row state in DB           : " + rowState(ds, rs2));
            System.out.println("S2 createExecution (retry)     : " + outcome(() -> service.createExecution("h2-" + run, rs2, "k2-" + run, ref2)));
            String id2 = ds == null ? executions.findByIdempotencyKey("k2-" + run).getExecutionCallId() : rowId(ds, rs2);
            System.out.println("S2 cancelExecution             : " + outcome(() -> service.cancelExecution("h2-" + run, rs2, id2)));
            System.out.println("S2 release session             : " + outcome(() -> service.release("h2-" + run, rs2)));
            System.out.println("S2 release session (again)     : " + outcome(() -> service.release("h2-" + run, rs2)));
            // S3: a result that embeds an OpenAPI external $ref.
            String rs3 = "rs3-" + run;
            System.out.println("S3 acquire                     : " + outcome(() -> service.acquire("h3-" + run, rs3, "bootstrap")));
            transport.executeResult = m("executionStatus", "success", "output", m("$ref", "./common.yaml#/components/schemas/Error"));
            Map<String, Object> ref3 = m("sessionId", rs3, "promptId", "p", "callId", "c", "argsDigest", "d");
            System.out.println("S3 createExecution             : " + outcome(() -> service.createExecution("h3-" + run, rs3, "k3-" + run, ref3)));
            System.out.println("S3 createExecution (retry)     : " + outcome(() -> service.createExecution("h3-" + run, rs3, "k3-" + run, ref3)));
            // S4: result output {"$ref":"$.executionStatus"} is silently rewritten.
            String rs4 = "rs4-" + run;
            System.out.println("S4 acquire                     : " + outcome(() -> service.acquire("h4-" + run, rs4, "bootstrap")));
            transport.executeResult = m("executionStatus", "success", "output", m("$ref", "$.executionStatus"));
            Map<String, Object> ref4 = m("sessionId", rs4, "promptId", "p", "callId", "c", "argsDigest", "d");
            System.out.println("S4 createExecution             : " + outcome(() -> service.createExecution("h4-" + run, rs4, "k4-" + run, ref4)));
            // S9/S10: JSON-LD style "@type" as the first member of a result object.
            Object[][] types = {{"S9", java.util.List.of("Product", "Thing")}, {"S10", null}};
            for (Object[] t : types) {
                String tag = (String) t[0];
                String rs = tag.toLowerCase() + "-" + run;
                System.out.println(tag + " acquire                    : " + outcome(() -> service.acquire("h" + rs, rs, "bootstrap")));
                Map<String, Object> output = m("@type", t[1], "name", "Widget");
                transport.executeResult = m("executionStatus", "success", "output", output);
                Map<String, Object> ref = m("sessionId", rs, "promptId", "p", "callId", "c", "argsDigest", "d");
                System.out.println(tag + " createExecution            : " + outcome(() -> service.createExecution("h" + rs, rs, "k" + rs, ref)));
                System.out.println(tag + " createExecution (retry)    : " + outcome(() -> service.createExecution("h" + rs, rs, "k" + rs, ref)));
            }
            // S5-S8: the Harness reference carries a finite number that BrokerValues accepts.
            transport.executeResult = Map.of("executionStatus", "success");
            Object[][] numbers = {{"S5", new java.math.BigDecimal("1E+400")}, {"S6", new java.math.BigDecimal("1.2345678901234567890123E+30")},
                    {"S7", 162544.13f}, {"S8", -1363683.0538119469d}};
            for (Object[] n : numbers) {
                String tag = (String) n[0];
                String rs = tag.toLowerCase() + "-" + run;
                System.out.println(tag + " acquire                     : " + outcome(() -> service.acquire("h" + rs, rs, "bootstrap")));
                Map<String, Object> ref = m("sessionId", rs, "promptId", "p", "callId", "c", "argsDigest", "d", "n", n[1]);
                System.out.println(tag + " createExecution             : " + outcome(() -> service.createExecution("h" + rs, rs, "k" + rs, ref)));
                System.out.println(tag + " createExecution (retry)     : " + outcome(() -> service.createExecution("h" + rs, rs, "k" + rs, ref)));
                System.out.println(tag + " release session             : " + outcome(() -> service.release("h" + rs, rs)));
            }
        }
    }
}
