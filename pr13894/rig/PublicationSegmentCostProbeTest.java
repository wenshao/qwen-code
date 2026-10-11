package com.alibaba.qwen.code.managedagent;

import static com.alibaba.qwen.code.managedagent.PublicationJournalFixture.PUBLICATION_TOKEN;
import static com.alibaba.qwen.code.managedagent.PublicationJournalFixture.WRITER_TOKEN;

import com.alibaba.qwen.code.managedagent.store.ToolPublicationContract;
import com.alibaba.qwen.code.managedagent.store.ToolPublicationDataStore;
import com.alibaba.qwen.code.managedagent.store.ToolPublicationObjectStore;
import com.alibaba.qwen.code.managedagent.store.ToolPublicationStore;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DelegatingDataSource;

/** PR #13894 verification probe (not part of the PR): JDBC statements and time per publishSegment. */
class PublicationSegmentCostProbeTest {
    @Test
    void segmentCost() throws Exception {
        Map<String, Integer> counts = new ConcurrentHashMap<>();
        boolean[] counting = {false};
        JdbcDataSource h2 = new JdbcDataSource();
        h2.setURL("jdbc:h2:mem:segment-cost-" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;LOCK_TIMEOUT=10000");
        var source = new DelegatingDataSource(h2) {
            @Override
            public Connection getConnection() throws SQLException {
                Connection connection = super.getConnection();
                return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Connection.class},
                        (proxy, method, args) -> {
                            try {
                                Object result = method.invoke(connection, args);
                                if (!method.getName().equals("prepareStatement")
                                        || !(result instanceof PreparedStatement statement)) {
                                    return result;
                                }
                                String sql = ((String) args[0]).replaceAll("\\s+", " ");
                                return Proxy.newProxyInstance(getClass().getClassLoader(),
                                        new Class<?>[] {PreparedStatement.class}, (prepared, call, values) -> {
                                            if (counting[0] && call.getName().startsWith("execute")) {
                                                counts.merge(sql.length() > 110 ? sql.substring(0, 110) : sql, 1, Integer::sum);
                                            }
                                            try {
                                                return call.invoke(statement, values);
                                            } catch (InvocationTargetException failure) {
                                                throw failure.getCause();
                                            }
                                        });
                            } catch (InvocationTargetException failure) {
                                throw failure.getCause();
                            }
                        });
            }
        };
        Flyway.configure().dataSource(source).load().migrate();
        var journal = PublicationJournalFixture.create(source, false);
        int segments = Integer.getInteger("probe.segments", 60);
        int unitBytes = 64 * 1024;
        long captureBytes = (long) segments * unitBytes;
        long allocated = captureBytes + ToolPublicationContract.PRODUCER_BYTES + ToolPublicationContract.ADMISSION_BYTES;
        var store = new ToolPublicationStore(journal.jdbc, journal.manager, journal.sessions, journal.executions,
                journal.bindings, new ToolPublicationStore.Capacity(captureBytes, allocated, allocated, 1), true);
        store.apply(journal.request("reserve").put("captureBytes", captureBytes), WRITER_TOKEN, PUBLICATION_TOKEN);
        Map<String, byte[]> objects = new ConcurrentHashMap<>();
        ToolPublicationObjectStore bucket = new ToolPublicationObjectStore() {
            @Override
            public void putIfAbsent(String key, byte[] bytes) {
                objects.putIfAbsent(key, bytes.clone());
            }

            @Override
            public InputStream open(String key) {
                return new ByteArrayInputStream(objects.get(key));
            }

            @Override
            public void requireUnversioned() {
            }
        };
        var data = new ToolPublicationDataStore(journal.jdbc, journal.manager, store, journal.sessions, bucket,
                Duration.ofMinutes(2), Duration.ofSeconds(30),
                new ToolPublicationDataStore.VerificationBudget(16 * 1024 * 1024, Duration.ofMinutes(25)));
        var key = journal.binding.get("sessionKey");
        byte[] unit = new byte[unitBytes];
        java.util.Arrays.fill(unit, (byte) 0x5a);
        String unitDigest = ToolPublicationContract.sha256(unit);
        data.publishSegment(key, "pub-1", PUBLICATION_TOKEN, "segment-0", "stdout", 0, unit, unitDigest);
        counting[0] = true;
        long start = System.nanoTime();
        for (int ordinal = 1; ordinal < segments; ordinal++) {
            data.publishSegment(key, "pub-1", PUBLICATION_TOKEN, "segment-" + ordinal, "stdout", ordinal, unit, unitDigest);
        }
        long elapsed = System.nanoTime() - start;
        counting[0] = false;
        int calls = segments - 1;
        int total = counts.values().stream().mapToInt(Integer::intValue).sum();
        var out = new StringBuilder();
        out.append(String.format("arm=%s calls=%d statementsPerCall=%.2f msPerCall=%.2f%n",
                System.getProperty("probe.arm"), calls, total / (double) calls, elapsed / 1e6 / calls));
        for (var entry : new TreeMap<>(counts).entrySet()) {
            out.append(String.format("%7.2f  %s%n", entry.getValue() / (double) calls, entry.getKey()));
        }
        Files.writeString(Path.of(System.getProperty("probe.out")), out.toString(), StandardCharsets.UTF_8);
        System.out.println(out);
    }
}
