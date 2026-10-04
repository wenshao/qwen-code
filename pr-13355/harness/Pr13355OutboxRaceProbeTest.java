package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.config.ManagedAgentProperties;
import com.alibaba.qwen.code.managedagent.store.ManagedAgentStore;
import com.alibaba.qwen.code.managedagent.store.ManagedWorkspaceRegistry;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** PR #13355 probe: concurrent writers of one Session's task-event outbox on real MySQL. */
class Pr13355OutboxRaceProbeTest {
    @Test
    void raceTheOutbox() throws Exception {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                System.getProperty("mysql.url"), System.getProperty("mysql.user"),
                System.getProperty("mysql.password"));
        Flyway.configure().dataSource(dataSource)
                .locations("classpath:db/migration").load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        ManagedAgentStore store = new ManagedAgentStore(jdbc, new ObjectMapper(),
                Clock.systemUTC(), ignored -> { }, new ManagedWorkspaceRegistry(jdbc),
                new ManagedAgentProperties());
        String tenant = "race-tenant";
        String sessionId = store.insertSessionCommand(tenant, "CREATE_SESSION",
                "race-" + UUID.randomUUID(), "race-digest", "qwen-code", null, null,
                List.of(), null).sessionId();
        TransactionTemplate tx = new TransactionTemplate(
                new DataSourceTransactionManager(dataSource));
        int threads = Integer.getInteger("probe.threads", 16);
        int each = Integer.getInteger("probe.each", 40);
        List<String> errors = Collections.synchronizedList(new ArrayList<>());
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        long began = System.nanoTime();
        for (int t = 0; t < threads; t++) {
            int thread = t;
            pool.submit(() -> {
                start.await();
                for (int i = 0; i < each; i++) {
                    int n = i;
                    try {
                        tx.executeWithoutResult(status -> store.appendLiveSessionTaskEvent(
                                tenant, sessionId, "task_" + thread, "running", n + 1,
                                "task:" + thread + ":" + n));
                    } catch (RuntimeException error) {
                        Throwable root = error;
                        while (root.getCause() != null) root = root.getCause();
                        errors.add(error.getClass().getSimpleName() + ": "
                                + String.valueOf(root.getMessage()).replaceAll("\\s+", " "));
                    }
                }
                return null;
            });
        }
        start.countDown();
        pool.shutdown();
        pool.awaitTermination(5, TimeUnit.MINUTES);
        long millis = (System.nanoTime() - began) / 1_000_000;
        Map<String, Object> rows = jdbc.queryForMap("SELECT COUNT(*) AS n_rows,"
                + " COUNT(DISTINCT sequence_id) AS n_distinct, MIN(sequence_id) AS min_seq,"
                + " MAX(sequence_id) AS max_seq FROM managed_agent_task_event"
                + " WHERE tenant_id = ? AND session_id = ?", tenant, sessionId);
        Map<String, Integer> kinds = new LinkedHashMap<>();
        for (String error : errors) {
            String key = error.length() > 140 ? error.substring(0, 140) : error;
            kinds.merge(key.replaceAll("'[^']*'", "'…'"), 1, Integer::sum);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("threads", threads);
        out.put("attempts", threads * each);
        out.put("millis", millis);
        out.put("rows", rows);
        out.put("errors", errors.size());
        out.put("errorKinds", kinds);
        Files.writeString(Path.of(System.getProperty("probe.out")),
                new ObjectMapper().writerWithDefaultPrettyPrinter().writeValueAsString(out));
    }
}
