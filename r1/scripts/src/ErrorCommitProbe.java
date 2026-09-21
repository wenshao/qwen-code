package com.alibaba.qwen.code.runtimebroker;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;

/**
 * Injects a Throwable at the Nth prepareStatement() of one findOrCreate() and
 * then looks at what the database kept.
 *
 * args: &lt;url&gt; &lt;label&gt;
 */
public final class ErrorCommitProbe {
    public static void main(String[] args) throws Exception {
        SimpleDs real = SimpleDs.of(args[0]);
        String label = args[1];
        JdbcRuntimeBrokerSchema.initialize(real);
        String run = "e" + System.nanoTime();
        // findOrCreate issues 5 statements: ensureSlot, selectSlot,
        // databaseNow, insertBinding, UPDATE slot. Fail the 5th.
        attempt(real, label, run + "-rt", new IllegalStateException(
                "injected RuntimeException"));
        attempt(real, label, run + "-err", new OutOfMemoryError(
                "injected java.lang.Error"));
    }

    private static void attempt(SimpleDs real, String label, String tenant,
            Throwable injected) throws Exception {
        RuntimeProvisionRequest request = new RuntimeProvisionRequest(
                new RuntimeScope(tenant, "workspace", "generation",
                        "/workspace", "capability", "session"), "iso");
        AtomicInteger calls = new AtomicInteger();
        DataSource faulty = (DataSource) Proxy.newProxyInstance(
                ErrorCommitProbe.class.getClassLoader(),
                new Class<?>[] {DataSource.class}, (p, method, a) -> {
                    Object result = invoke(real, method, a);
                    if (!"getConnection".equals(method.getName())) {
                        return result;
                    }
                    Connection connection = (Connection) result;
                    return Proxy.newProxyInstance(
                            ErrorCommitProbe.class.getClassLoader(),
                            new Class<?>[] {Connection.class},
                            (cp, cm, ca) -> {
                                if ("prepareStatement".equals(cm.getName())
                                        && calls.incrementAndGet() == 5) {
                                    throw injected;
                                }
                                return invoke(connection, cm, ca);
                            });
                });
        System.out.println("[" + label + "] --- inject "
                + injected.getClass().getSimpleName()
                + " before the slot UPDATE (statement 5 of 5)");
        try {
            new JdbcRuntimeBindingRepository(faulty, () -> tenant + "-b1")
                    .findOrCreate(request);
        } catch (Throwable thrown) {
            System.out.println("[" + label + "] findOrCreate threw "
                    + thrown.getClass().getSimpleName());
        }
        try (Connection connection = real.getConnection();
                Statement statement = connection.createStatement()) {
            try (ResultSet rs = statement.executeQuery(
                    "SELECT (SELECT COUNT(*) FROM qwen_runtime_binding WHERE "
                            + "tenant_id = '" + tenant + "'), (SELECT "
                            + "CONCAT(last_generation, '/', COALESCE("
                            + "active_binding_id, 'NULL')) FROM "
                            + "qwen_runtime_binding_slot WHERE tenant_id = '"
                            + tenant + "')")) {
                rs.next();
                System.out.println("[" + label + "] committed binding rows="
                        + rs.getLong(1) + "  slot last_generation/active="
                        + rs.getString(2));
            }
        }
        for (int i = 1; i <= 2; i++) {
            try {
                RuntimeBindingRecord record = new JdbcRuntimeBindingRepository(
                        real, () -> tenant + "-b2").findOrCreate(request);
                System.out.println("[" + label + "] healthy retry #" + i
                        + " -> " + record.getBindingId() + " generation="
                        + record.getGeneration());
            } catch (RuntimeException failure) {
                System.out.println("[" + label + "] healthy retry #" + i
                        + " -> FAILS: " + RaceWorker.rootMessage(failure));
            }
        }
    }

    private static Object invoke(Object target, java.lang.reflect.Method m,
            Object[] a) throws Throwable {
        try {
            return m.invoke(target, a);
        } catch (InvocationTargetException wrapped) {
            throw wrapped.getCause();
        }
    }
}
