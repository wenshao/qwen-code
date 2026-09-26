package com.alibaba.qwen.code.runtimebroker;

import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;

/**
 * Verification probe for PR #12788. Uses only APIs present on both base and
 * head so the same file measures both arms. Not part of the PR.
 */
class LeaseClockProbe {
    private static final String ARM = System.getProperty("probe.arm", "?");
    private static final String OUT = System.getProperty("probe.out",
            "probe.out");
    private static final int N = Integer.getInteger("probe.n", 20);

    private static DataSource source() {
        String url = System.getProperty("probe.url");
        if (url == null) {
            JdbcDataSource h2 = new JdbcDataSource();
            h2.setURL("jdbc:h2:mem:probe-" + UUID.randomUUID()
                    + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
            return h2;
        }
        return new DriverManagerDataSource(url,
                System.getProperty("probe.user", "root"),
                System.getProperty("probe.password", ""));
    }

    private static String db() {
        String url = System.getProperty("probe.url");
        if (url == null) {
            return "h2";
        }
        return url.contains("sendFractionalSeconds=false")
                ? "mysql-nofrac" : "mysql";
    }

    private static synchronized void emit(String line) throws IOException {
        try (PrintWriter out = new PrintWriter(new FileWriter(OUT, true))) {
            out.println(ARM + " " + db() + " " + line);
        }
        System.out.println(line);
    }

    /** Spin until the wall clock is at the given millisecond of a second. */
    private static void alignTo(int offsetMs) throws InterruptedException {
        while (true) {
            long ms = System.currentTimeMillis() % 1000;
            if (ms >= offsetMs && ms < offsetMs + 3) {
                return;
            }
            long delta = (offsetMs - ms + 1000) % 1000;
            if (delta > 20) {
                Thread.sleep(delta - 15);
            } else {
                Thread.onSpinWait();
            }
        }
    }

    private static RuntimeProvisionRequest request(String tenant) {
        return new RuntimeProvisionRequest(new RuntimeScope(tenant,
                "workspace", "generation", "/workspace", "capability",
                "session"), tenant + "-isolation", "local-process");
    }

    private static SecretProtector protector() {
        byte[] key = new byte[32];
        for (int i = 0; i < key.length; i++) {
            key[i] = (byte) (i + 1);
        }
        return new AesGcmSecretProtector("probe-key", key);
    }

    private static ToolExecutionRecord execution(String id) {
        return ToolExecutionRecord.prepared(id, id + "-idem",
                id + "-binding", 1, id + "-harness", id + "-rs",
                id + "-turn", id + "-tool", id + "-digest",
                Map.of("sessionId", id + "-rs", "promptId", id + "-turn",
                        "callId", id + "-tool", "argsDigest",
                        id + "-digest"));
    }

    /**
     * Owner A claims a lease at a known offset inside a wall-clock second;
     * owner B polls every 5 ms until it can take the lease over. Reports the
     * stored deadline minus the claim start ("granted") and the measured
     * takeover delay ("lifetime").
     */
    @Test
    void bindingLeaseLifetime() throws Exception {
        DataSource source = source();
        JdbcRuntimeBrokerSchema.initialize(source);
        String run = UUID.randomUUID().toString().substring(0, 8);
        int[] seq = {0};
        JdbcRuntimeBindingRepository repo = new JdbcRuntimeBindingRepository(
                source, protector(), () -> run + "-b-" + (++seq[0]));
        for (long leaseMs : new long[] {1000, 1500}) {
            Duration lease = Duration.ofMillis(leaseMs);
            for (int i = 0; i < N; i++) {
                int offset = (int) ((i * 1000L / N + 5) % 1000);
                String id = repo.findOrCreate(request(run + "-t" + leaseMs
                        + "-" + i)).getBindingId();
                alignTo(offset);
                long startMs = System.currentTimeMillis();
                long start = System.nanoTime();
                RuntimeBindingRecord a = repo.claimOperation(id, "owner-a",
                        lease);
                long grantedMs = a.getOperationLeaseUntil().toEpochMilli()
                        - startMs;
                RuntimeBindingRecord b;
                do {
                    Thread.sleep(5);
                    b = repo.claimOperation(id, "owner-b", lease);
                } while (b == null);
                long lifetimeMs = (System.nanoTime() - start) / 1_000_000;
                emit("binding lease=" + leaseMs + " offset=" + offset
                        + " granted=" + grantedMs + " lifetime="
                        + lifetimeMs);
            }
        }
    }

    @Test
    void dispatchLeaseLifetime() throws Exception {
        DataSource source = source();
        JdbcRuntimeBrokerSchema.initialize(source);
        String run = UUID.randomUUID().toString().substring(0, 8);
        JdbcToolExecutionRepository repo = new JdbcToolExecutionRepository(
                source);
        long leaseMs = 1000;
        Duration lease = Duration.ofMillis(leaseMs);
        for (int i = 0; i < N; i++) {
            int offset = (int) ((i * 1000L / N + 5) % 1000);
            String id = repo.findOrCreate(execution(run + "-x-" + i))
                    .getExecutionCallId();
            alignTo(offset);
            long startMs = System.currentTimeMillis();
            long start = System.nanoTime();
            ToolExecutionRecord a = repo.claimDispatch(id, "dispatcher-a",
                    lease);
            long grantedMs = a.getDispatchLeaseUntil().toEpochMilli()
                    - startMs;
            ToolExecutionRecord b;
            do {
                Thread.sleep(5);
                b = repo.claimDispatch(id, "dispatcher-b", lease);
            } while (b == null);
            long lifetimeMs = (System.nanoTime() - start) / 1_000_000;
            emit("dispatch lease=" + leaseMs + " offset=" + offset
                    + " granted=" + grantedMs + " lifetime=" + lifetimeMs);
        }
    }

    /**
     * The Broker renews at lease/3. Claim a 1 s lease, renew every 333 ms for
     * 3 s, then compare-and-set with the last renewed record.
     */
    @Test
    void renewalChain() throws Exception {
        DataSource source = source();
        JdbcRuntimeBrokerSchema.initialize(source);
        String run = UUID.randomUUID().toString().substring(0, 8);
        int[] seq = {0};
        JdbcRuntimeBindingRepository bindings =
                new JdbcRuntimeBindingRepository(source, protector(),
                        () -> run + "-r-" + (++seq[0]));
        JdbcToolExecutionRepository executions =
                new JdbcToolExecutionRepository(source);
        Duration lease = Duration.ofSeconds(1);
        for (int i = 0; i < N; i++) {
            int offset = (int) ((i * 1000L / N + 5) % 1000);
            String id = bindings.findOrCreate(request(run + "-rt-" + i))
                    .getBindingId();
            String xid = executions.findOrCreate(execution(run + "-rx-" + i))
                    .getExecutionCallId();
            alignTo(offset);
            RuntimeBindingRecord op = bindings.claimOperation(id, "owner",
                    lease);
            ToolExecutionRecord dx = executions.claimDispatch(xid,
                    "dispatcher", lease);
            int opRefused = -1;
            int dxRefused = -1;
            for (int k = 1; k <= 9; k++) {
                Thread.sleep(333);
                if (opRefused < 0) {
                    RuntimeBindingRecord next = bindings.renewOperation(id,
                            "owner", op.getOperationGeneration(), lease);
                    if (next == null) {
                        opRefused = k;
                    } else {
                        op = next;
                    }
                }
                if (dxRefused < 0) {
                    ToolExecutionRecord next = executions.renewDispatch(xid,
                            "dispatcher", dx.getDispatchGeneration(), lease);
                    if (next == null) {
                        dxRefused = k;
                    } else {
                        dx = next;
                    }
                }
            }
            boolean opCas = opRefused < 0 && bindings.compareAndSet(op,
                    op.withDrainRequested(true,
                            Instant.parse("2026-09-20T00:00:00Z"))) != null;
            boolean dxCas = dxRefused < 0 && executions.compareAndSet(dx,
                    dx.withState(ToolExecutionRecord.State.EXECUTING, false),
                    "dispatcher", dx.getDispatchGeneration()) != null;
            emit("renew offset=" + offset + " opRefusedAt=" + opRefused
                    + " dxRefusedAt=" + dxRefused + " opCas=" + opCas
                    + " dxCas=" + dxCas);
        }
    }

    /**
     * The precise clock combines UNIX_TIMESTAMP() with the microseconds of
     * CURRENT_TIMESTAMP(6). Check each reading lies inside the JVM clock
     * bracket around the query and that readings never go backwards.
     */
    @Test
    void preciseClockConsistency() throws Exception {
        DataSource source = source();
        String[] zones = db().equals("h2") ? new String[] {null}
                : new String[] {"+00:00", "+08:00", "-04:00"};
        for (String zone : zones) {
            try (Connection connection = source.getConnection()) {
                if (zone != null) {
                    try (PreparedStatement set = connection.prepareStatement(
                            "SET time_zone = '" + zone + "'")) {
                        set.execute();
                    }
                }
                int outside = 0;
                int backwards = 0;
                long worstUs = 0;
                Instant previous = Instant.EPOCH;
                int samples = 5000;
                for (int i = 0; i < samples; i++) {
                    Instant before = Instant.now();
                    Instant value;
                    try (PreparedStatement statement = connection
                            .prepareStatement("SELECT UNIX_TIMESTAMP(),"
                                    + " EXTRACT(MICROSECOND FROM"
                                    + " CURRENT_TIMESTAMP(6))");
                            ResultSet result = statement.executeQuery()) {
                        result.next();
                        value = Instant.ofEpochSecond(result.getLong(1),
                                result.getLong(2) * 1_000L);
                    }
                    Instant after = Instant.now();
                    // 1 ms slack: the database clock is microsecond-precise.
                    if (value.isBefore(before.minusMillis(1))
                            || value.isAfter(after.plusMillis(1))) {
                        outside++;
                        long us = Math.max(
                                Duration.between(value, before).toNanos(),
                                Duration.between(after, value).toNanos())
                                / 1_000;
                        worstUs = Math.max(worstUs, us);
                    }
                    if (value.isBefore(previous)) {
                        backwards++;
                    }
                    previous = value;
                }
                emit("clock zone=" + zone + " samples=" + samples
                        + " outsideBracket=" + outside + " backwards="
                        + backwards + " worstUs=" + worstUs);
            }
        }
    }
}
