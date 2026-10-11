package com.alibaba.qwen.code.managedagent;

import static com.alibaba.qwen.code.managedagent.PublicationJournalFixture.PUBLICATION_TOKEN;
import static com.alibaba.qwen.code.managedagent.PublicationJournalFixture.WRITER_TOKEN;

import com.alibaba.qwen.code.managedagent.store.ManagedSessionStoreModels.AuthorizeLifecycleRequest;
import com.alibaba.qwen.code.managedagent.store.WorkspaceCsiRegistration;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * PR #13894 maintainer verification probe (not part of the PR): how long a standalone publication
 * mutation (the HTTP controller path, no ambient transaction) waits while a same-tenant
 * transaction holds the tenant placement guard for a fixed time.
 */
class PublicationPlacementHoldProbeTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void holds() throws Exception {
        String url = System.getProperty("mysql.url");
        String user = System.getProperty("mysql.user");
        String password = System.getProperty("mysql.password", "");
        String arm = System.getProperty("probe.arm", "unknown");
        Path out = Path.of(System.getProperty("probe.out"));
        long holdMs = Long.getLong("probe.holdMs", 15000);
        int reps = Integer.getInteger("probe.reps", 2);
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        for (String scenario : List.of(System.getProperty("probe.scenarios",
                "ordinary-renew,ordinary-reserve,csi-renew").split(","))) {
            for (int rep = 1; rep <= reps; rep++) {
                ObjectNode result = JSON.createObjectNode().put("arm", arm).put("scenario", scenario)
                        .put("rep", rep).put("holdMs", holdMs);
                String schema = "p13894h_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                admin.execute("CREATE DATABASE " + schema);
                try {
                    run(scenario, new HoldDataSource(new DriverManagerDataSource(
                            url.replaceFirst("/[^/?]+(?=\\?|$)", "/" + schema), user, password)), holdMs, result);
                } catch (Throwable error) {
                    result.put("probeError", describe(error));
                } finally {
                    admin.execute("DROP DATABASE " + schema);
                }
                Files.writeString(out, result + "\n", StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                System.out.println("PROBE " + result);
            }
        }
    }

    private void run(String scenario, HoldDataSource source, long holdMs, ObjectNode result) throws Exception {
        Flyway.configure().dataSource(source).load().migrate();
        boolean csi = scenario.startsWith("csi");
        var registration = csi ? new WorkspaceCsiRegistration("tenant-1", "fixture-storage", "fixture-cluster",
                "fixture", "fixture-claim", "fixture-pvc", "fixture-volume", "fixture-pv",
                "fixture.csi", "fixture-handle", "fixture-backend", "fixture-serial", "/workspace", 1) : null;
        var journal = PublicationJournalFixture.create(source, false, registration);
        if (!scenario.endsWith("reserve")) {
            journal.reserve();
        }
        Runnable subject = scenario.endsWith("reserve") ? journal::reserve
                : () -> journal.store.apply(journal.request("renew"), WRITER_TOKEN, PUBLICATION_TOKEN);
        var ownerError = new AtomicReference<Throwable>();
        var subjectError = new AtomicReference<Throwable>();
        source.enabled = true;
        Thread owner = new Thread(() -> {
            try {
                new TransactionTemplate(journal.manager).executeWithoutResult(status ->
                        journal.sessions.authorizeOrdinary("tenant-1", "session-1", WRITER_TOKEN,
                                new AuthorizeLifecycleRequest("workspace-1", "writer-1", 1)));
            } catch (Throwable error) {
                ownerError.set(error);
            }
        }, "owner");
        owner.start();
        if (!source.ownerPlacement.await(30, TimeUnit.SECONDS)) {
            throw new AssertionError("Owner never acquired placement");
        }
        long start = System.nanoTime();
        long[] end = {0};
        Thread subjectThread = new Thread(() -> {
            try {
                subject.run();
            } catch (Throwable error) {
                subjectError.set(error);
            } finally {
                end[0] = System.nanoTime();
            }
        }, "subject");
        subjectThread.start();
        subjectThread.join(holdMs);
        boolean doneDuringHold = !subjectThread.isAlive();
        source.releaseOwner.countDown();
        subjectThread.join(120_000);
        owner.join(120_000);
        result.put("subjectFinishedWhileOwnerHeldPlacement", doneDuringHold);
        result.put("subjectMs", (end[0] - start) / 1_000_000);
        result.put("subject", subjectError.get() == null ? "ok" : describe(subjectError.get()));
        result.put("owner", ownerError.get() == null ? "ok" : describe(ownerError.get()));
    }

    private static String describe(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        return error.getClass().getSimpleName() + " / " + root.getClass().getSimpleName() + ": "
                + String.valueOf(root.getMessage()).replace('\n', ' ');
    }

    private static final class HoldDataSource extends DelegatingDataSource {
        final CountDownLatch ownerPlacement = new CountDownLatch(1);
        final CountDownLatch releaseOwner = new CountDownLatch(1);
        final AtomicBoolean paused = new AtomicBoolean();
        volatile boolean enabled;

        HoldDataSource(DataSource source) {
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
                            return Proxy.newProxyInstance(getClass().getClassLoader(),
                                    new Class<?>[] {PreparedStatement.class}, (prepared, call, values) -> {
                                        try {
                                            Object value = call.invoke(statement, values);
                                            if (enabled && call.getName().startsWith("execute")
                                                    && "owner".equals(Thread.currentThread().getName())
                                                    && sql.startsWith("SELECT tenant_id FROM qwen_runtime_placement_guard")
                                                    && paused.compareAndSet(false, true)) {
                                                ownerPlacement.countDown();
                                                if (!releaseOwner.await(120, TimeUnit.SECONDS)) {
                                                    throw new AssertionError("Owner hold timed out");
                                                }
                                            }
                                            return value;
                                        } catch (InvocationTargetException error) {
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
