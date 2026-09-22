package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.ProbeKit.*;

import java.net.URI;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalTime;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;

/**
 * One Broker process on a shared MySQL database. The provisioner writes
 * every physical provision call to probe_provision_log so counts are
 * visible across processes.
 *
 * args: owner jdbcUrl command workspace [extra]
 * system properties: provisionMillis, leaseMillis, startAt (epoch ms)
 */
public final class BrokerNode {
    public static void main(String[] args) throws Exception {
        String owner = args[0];
        DataSource source = RaceStress.dataSource(args[1]);
        String command = args[2];
        String workspace = args[3];
        long provisionMillis = Long.getLong("provisionMillis", 0);
        Duration lease = Duration.ofMillis(Long.getLong("leaseMillis",
                60_000));
        JdbcRuntimeBrokerSchema.initialize(source);
        exec(source, "CREATE TABLE IF NOT EXISTS probe_provision_log ("
                + "id BIGINT AUTO_INCREMENT PRIMARY KEY, owner VARCHAR(64),"
                + " workspace VARCHAR(128), lease_id VARCHAR(128),"
                + " at_ms BIGINT)");
        RuntimeScope scope = new RuntimeScope("tenant", workspace, "g1",
                "/w/" + workspace, "cap", "workspace");
        RuntimeProvisioner provisioner = request -> {
            String leaseId = "lease-" + owner;
            exec(source, "INSERT INTO probe_provision_log (owner, workspace,"
                    + " lease_id, at_ms) VALUES ('" + owner + "', '"
                    + workspace + "', '" + leaseId + "', "
                    + System.currentTimeMillis() + ")");
            log(owner, "provisioner called (takes " + provisionMillis
                    + " ms)");
            RuntimeLease result = new RuntimeLease("runtime-" + owner,
                    URI.create("http://127.0.0.1:4100"), "token-" + owner,
                    leaseId, 1);
            return CompletableFuture.supplyAsync(() -> result,
                    CompletableFuture.delayedExecutor(provisionMillis,
                            TimeUnit.MILLISECONDS));
        };
        Transport transport = new Transport();
        RuntimeBrokerService service = new RuntimeBrokerService(
                harness -> CompletableFuture.completedFuture(scope),
                provisioner, transport,
                new JdbcRuntimeBindingRepository(source),
                new JdbcRuntimeSessionRepository(source),
                new InMemoryToolExecutionRepository(), owner, lease, lease,
                Clock.systemUTC(), () -> java.util.UUID.randomUUID()
                        .toString());
        long startAt = Long.getLong("startAt", 0);
        while (System.currentTimeMillis() < startAt) {
            Thread.onSpinWait();
        }
        switch (command) {
            case "warm-retry" -> warmRetry(service, owner,
                    Long.parseLong(args[4]));
            case "acquire-and-exit" -> {
                RuntimeSessionRecord record = join(service.acquire("h-1",
                        "rs-1", "bootstrap"));
                log(owner, "acquired rs-1 -> " + record.getState()
                        + " on binding generation "
                        + record.getRuntimeGeneration()
                        + "; process exits without release");
            }
            case "after-restart" -> {
                log(owner, "warm(h-1)            -> "
                        + outcome(() -> service.warm("h-1")));
                log(owner, "acquire(h-1, rs-1)   -> " + outcome(
                        () -> service.acquire("h-1", "rs-1", "bootstrap")));
                log(owner, "release(h-1, rs-1)   -> " + outcome(
                        () -> service.release("h-1", "rs-1")));
                log(owner, "acquire(h-2, rs-2)   -> " + outcome(
                        () -> service.acquire("h-2", "rs-2", "bootstrap")));
            }
            default -> throw new IllegalArgumentException(command);
        }
        service.close();
        System.exit(0);
    }

    private static void warmRetry(RuntimeBrokerService service, String owner,
            long deadlineMillis) {
        long deadline = System.currentTimeMillis() + deadlineMillis;
        String last = null;
        int attempts = 0;
        while (System.currentTimeMillis() < deadline) {
            attempts++;
            String result = outcome(() -> service.warm("h-1"));
            if (!result.equals(last)) {
                log(owner, "warm attempt " + attempts + " -> " + result);
                last = result;
            }
            if ("ok".equals(result) || !result.contains("retryable=true")) {
                break;
            }
            sleep(100);
        }
        log(owner, "final after " + attempts + " attempt(s): " + last);
    }

    static void log(String owner, String text) {
        System.out.println(LocalTime.now().withNano(
                LocalTime.now().getNano() / 1_000_000 * 1_000_000) + " ["
                + owner + "] " + text);
        System.out.flush();
    }

    static void exec(DataSource source, String sql) {
        try (Connection connection = source.getConnection();
                PreparedStatement statement = connection.prepareStatement(
                        sql)) {
            statement.execute();
        } catch (SQLException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
