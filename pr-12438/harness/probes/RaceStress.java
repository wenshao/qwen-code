package com.alibaba.qwen.code.runtimebroker;

import static com.alibaba.qwen.code.runtimebroker.ProbeKit.*;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;

/**
 * Unhooked stress for the PROVISIONING -> READY edge: no repository pause,
 * only real threads. Each round is a fresh workspace; one caller starts the
 * provisioning, then N callers acquire distinct Runtime Sessions while a
 * completer thread finishes the provisioning at a random microsecond.
 * Counts rounds in which one binding was provisioned more than once.
 * args: backend(memory|h2|mysql) rounds callers [jdbcUrl]
 */
public final class RaceStress {
    public static void main(String[] args) throws Exception {
        String backend = args[0];
        int rounds = Integer.parseInt(args[1]);
        int callers = Integer.parseInt(args[2]);
        RuntimeBindingRepository bindings;
        RuntimeSessionRepository sessions;
        if ("memory".equals(backend)) {
            bindings = new InMemoryRuntimeBindingRepository();
            sessions = new InMemoryRuntimeSessionRepository();
        } else {
            DataSource source = dataSource(args[3]);
            JdbcRuntimeBrokerSchema.initialize(source);
            bindings = new JdbcRuntimeBindingRepository(source);
            sessions = new JdbcRuntimeSessionRepository(source);
        }
        long pauseMicros = Long.getLong("pauseAfterReadMicros", 0);
        if (pauseMicros > 0) {
            // Model a caller descheduled (GC pause, CPU contention) right
            // after it read a PROVISIONING row.
            PausingBindingRepository paused =
                    new PausingBindingRepository(bindings);
            paused.afterFindOrCreate = record -> {
                if (record.getState()
                        == RuntimeBindingRecord.State.PROVISIONING) {
                    java.util.concurrent.locks.LockSupport.parkNanos(
                            pauseMicros * 1000);
                }
            };
            bindings = paused;
        }
        Map<String, AtomicInteger> provisions = new ConcurrentHashMap<>();
        Map<String, CompletableFuture<RuntimeLease>> pending =
                new ConcurrentHashMap<>();
        AtomicInteger leaseIds = new AtomicInteger();
        RuntimeProvisioner provisioner = request -> {
            String workspace = request.getScope().getWorkspaceId();
            provisions.computeIfAbsent(workspace,
                    ignored -> new AtomicInteger()).incrementAndGet();
            CompletableFuture<RuntimeLease> first = pending.get(workspace);
            if (first != null && !first.isDone()) {
                return first;
            }
            return CompletableFuture.completedFuture(
                    lease(1000 + leaseIds.incrementAndGet()));
        };
        String run = Long.toString(System.nanoTime(), 36);
        Map<String, RuntimeScope> scopes = new ConcurrentHashMap<>();
        HarnessSessionResolver resolver = harness ->
                CompletableFuture.completedFuture(scopes.get(harness));
        Transport transport = new Transport();
        RuntimeBrokerService service = new RuntimeBrokerService(resolver,
                provisioner, transport, bindings, sessions,
                new InMemoryToolExecutionRepository(), "broker-" + run,
                Duration.ofMinutes(5), Duration.ofMinutes(5),
                Clock.systemUTC(), () -> java.util.UUID.randomUUID()
                        .toString());
        int doubled = 0;
        int errors = 0;
        Map<String, Integer> errorKinds = new java.util.TreeMap<>();
        long started = System.nanoTime();
        for (int round = 0; round < rounds; round++) {
            String workspace = "w-" + run + "-" + round;
            RuntimeScope scope = new RuntimeScope("tenant", workspace, "g",
                    "/w", "cap", "workspace");
            for (int i = 0; i <= callers; i++) {
                scopes.put(workspace + "-h" + i, scope);
            }
            CompletableFuture<RuntimeLease> first = new CompletableFuture<>();
            pending.put(workspace, first);
            var starter = service.acquire(workspace + "-h0",
                    workspace + "-rs0", "bootstrap");
            CyclicBarrier barrier = new CyclicBarrier(callers + 1);
            Thread[] threads = new Thread[callers + 1];
            List<Object> results = new java.util.concurrent
                    .CopyOnWriteArrayList<>();
            for (int i = 1; i <= callers; i++) {
                int index = i;
                threads[i] = new Thread(() -> {
                    try {
                        barrier.await();
                        results.add(join(service.acquire(workspace + "-h"
                                + index, workspace + "-rs" + index,
                                "bootstrap")));
                    } catch (Exception exception) {
                        results.add(exception);
                    }
                });
            }
            threads[0] = new Thread(() -> {
                try {
                    barrier.await();
                    long spin = ThreadLocalRandom.current().nextLong(
                            Long.getLong("spinNanos", 200_000));
                    long until = System.nanoTime() + spin;
                    while (System.nanoTime() < until) {
                        Thread.onSpinWait();
                    }
                    first.complete(lease(1));
                } catch (Exception exception) {
                    throw new IllegalStateException(exception);
                }
            });
            for (Thread thread : threads) {
                thread.start();
            }
            for (Thread thread : threads) {
                thread.join();
            }
            join(starter);
            int calls = provisions.get(workspace).get();
            if (calls > 1) {
                doubled++;
                if (doubled <= 3) {
                    RuntimeBindingRecord binding = bindings.findActive(
                            new RuntimeProvisionRequest(scope, null));
                    System.out.println("  " + R + "round " + round + N
                            + ": provisioner called " + calls
                            + "x; durable lease now "
                            + binding.getLease().getLeaseId() + ", version "
                            + binding.getVersion());
                }
            }
            for (Object result : results) {
                if (result instanceof Exception exception) {
                    errors++;
                    String key = describe(unwrap(exception));
                    errorKinds.merge(key, 1, Integer::sum);
                }
            }
        }
        double seconds = (System.nanoTime() - started) / 1e9;
        System.out.printf("%s%s%s rounds=%d callers/round=%d  "
                + "double-provisioned rounds=%s%d%s  acquire errors=%d  "
                + "(%.1fs)%n", C, backend, N, rounds, callers,
                doubled > 0 ? R : G, doubled, N, errors, seconds);
        errorKinds.forEach((kind, count) -> System.out.println("  error x"
                + count + ": " + kind));
        service.close();
        System.exit(0);
    }

    static DataSource dataSource(String url) {
        return new DataSource() {
            @Override
            public Connection getConnection() throws SQLException {
                return DriverManager.getConnection(url);
            }

            @Override
            public Connection getConnection(String user, String password)
                    throws SQLException {
                return DriverManager.getConnection(url, user, password);
            }

            @Override
            public java.io.PrintWriter getLogWriter() {
                return null;
            }

            @Override
            public void setLogWriter(java.io.PrintWriter out) {
            }

            @Override
            public void setLoginTimeout(int seconds) {
            }

            @Override
            public int getLoginTimeout() {
                return 0;
            }

            @Override
            public java.util.logging.Logger getParentLogger() {
                return java.util.logging.Logger.getGlobal();
            }

            @Override
            public <T> T unwrap(Class<T> type) throws SQLException {
                throw new SQLException("not a wrapper");
            }

            @Override
            public boolean isWrapperFor(Class<?> type) {
                return false;
            }
        };
    }
}
