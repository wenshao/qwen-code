package com.alibaba.qwen.code.runtimebroker;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/** Same calls against in-memory and JDBC repositories; prints outcomes side by side. args: url label */
public final class CollationProbe {
    private static final Instant T = Instant.parse("2026-09-20T00:00:00Z");

    public static void main(String[] args) throws Exception {
        String label = args[1];
        RuntimeBindingRepository bindings;
        RuntimeSessionRepository sessions;
        String[] ids = {"Bind-1", "bind-1", "bind-2", "bind-3", "bind-4"};
        AtomicInteger next = new AtomicInteger();
        Supplier<String> supplier = () -> ids[next.getAndIncrement()];
        String run = "c" + System.nanoTime();
        if ("memory".equals(args[0])) {
            bindings = new InMemoryRuntimeBindingRepository(
                    java.time.Clock.systemUTC(), supplier);
            sessions = new InMemoryRuntimeSessionRepository();
        } else {
            SimpleDs ds = SimpleDs.of(args[0]);
            JdbcRuntimeBrokerSchema.initialize(ds);
            try (java.sql.Connection c = ds.getConnection();
                    java.sql.Statement s = c.createStatement()) {
                s.executeUpdate("DELETE FROM qwen_runtime_binding WHERE "
                        + "binding_id IN ('Bind-1','bind-1','bind-2',"
                        + "'bind-3','bind-4')");
            }
            bindings = new JdbcRuntimeBindingRepository(ds, supplier);
            sessions = new JdbcRuntimeSessionRepository(ds);
        }
        RuntimeScope scope = new RuntimeScope(run, "workspace", "generation",
                "/workspace", "capability", "session");
        row(label, "1 create binding isolationKey=Team-A (id Bind-1)",
                () -> bindings.findOrCreate(new RuntimeProvisionRequest(
                        scope, "Team-A")).getBindingId());
        row(label, "2 findActiveByIsolationKey(scope, \"team-a\")",
                () -> bindings.findActiveByIsolationKey(scope, "team-a")
                        .stream().map(RuntimeBindingRecord::getBindingId)
                        .collect(Collectors.toList()).toString());
        row(label, "3 create binding isolationKey=other (id bind-1)",
                () -> bindings.findOrCreate(new RuntimeProvisionRequest(
                        scope, "other")).getBindingId());
        row(label, "4 findById(\"BIND-1\")", () -> String.valueOf(
                bindings.findById("BIND-1")));
        row(label, "5 create session id=Sess-1", () -> sessions.findOrCreate(
                session(scope, "Sess-1")).getRuntimeSessionId());
        row(label, "6 create session id=sess-1", () -> sessions.findOrCreate(
                session(scope, "sess-1")).getRuntimeSessionId());
        row(label, "7 findById(scope, \"SESS-1\")", () -> String.valueOf(
                sessions.findById(scope, "SESS-1")));
        row(label, "8 countActiveByBinding(\"the-binding\", 1)",
                () -> String.valueOf(sessions.countActiveByBinding(
                        "the-binding", 1)));
        row(label, "9 countActiveByBinding(\"THE-BINDING\", 1)",
                () -> String.valueOf(sessions.countActiveByBinding(
                        "THE-BINDING", 1)));
        row(label, "10 create session id=café then id=cafe", () -> {
            sessions.findOrCreate(session(scope, "café"));
            return sessions.findOrCreate(session(scope, "cafe"))
                    .getRuntimeSessionId();
        });
        row(label, "11 create session id=\"pad\" then id=\"pad \"", () -> {
            sessions.findOrCreate(session(scope, "pad"));
            return "[" + sessions.findOrCreate(session(scope, "pad "))
                    .getRuntimeSessionId() + "]";
        });
    }

    private static RuntimeSessionRecord session(RuntimeScope scope,
            String id) {
        return new RuntimeSessionRecord(new RuntimeSession("harness", id,
                "bootstrap", scope), "the-binding", 1,
                RuntimeSessionRecord.State.ACQUIRING, 0, T);
    }

    private static void row(String label, String what,
            java.util.concurrent.Callable<String> call) {
        String outcome;
        try {
            outcome = call.call();
        } catch (Exception failure) {
            Throwable root = failure;
            while (root.getCause() != null) {
                root = root.getCause();
            }
            String message = String.valueOf(failure.getMessage());
            outcome = "THROWS " + failure.getClass().getSimpleName() + ": "
                    + message + (root == failure ? "" : " <- "
                            + String.valueOf(root.getMessage()).substring(0,
                                    Math.min(70, String.valueOf(
                                            root.getMessage()).length())));
        }
        System.out.printf("[%-9s] %-52s %s%n", label, what, outcome);
    }
}
