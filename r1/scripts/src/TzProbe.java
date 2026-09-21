package com.alibaba.qwen.code.runtimebroker;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.TimeZone;

/**
 * Timezone probe for JdbcRepositorySupport.databaseNow().
 *
 * single &lt;url&gt; &lt;label&gt;            one-process skew report
 * claim  &lt;url&gt; &lt;key&gt; &lt;owner&gt; &lt;sec&gt; claim an operation lease on scope &lt;key&gt;
 * renew  &lt;url&gt; &lt;key&gt; &lt;owner&gt; &lt;gen&gt; &lt;sec&gt;
 */
public final class TzProbe {
    private TzProbe() {
    }

    public static void main(String[] args) throws Exception {
        String mode = args[0];
        SimpleDs ds = SimpleDs.of(args[1]);
        JdbcRuntimeBrokerSchema.initialize(ds);
        if ("single".equals(mode)) {
            single(ds, args[2]);
        } else if ("claim".equals(mode)) {
            claim(ds, args[2], args[3], Long.parseLong(args[4]));
        } else if ("renew".equals(mode)) {
            renew(ds, args[2], args[3], Long.parseLong(args[4]),
                    Long.parseLong(args[5]));
        } else {
            throw new IllegalArgumentException(mode);
        }
    }

    private static RuntimeProvisionRequest request(String key) {
        return new RuntimeProvisionRequest(new RuntimeScope("tz-" + key,
                "workspace", "generation", "/workspace", "capability",
                "session"), "iso");
    }

    private static void single(SimpleDs ds, String label) throws Exception {
        String sessionTz;
        String globalTz;
        String systemTz;
        String raw;
        Instant dbNow;
        Instant jvmNow;
        try (Connection connection = ds.getConnection();
                Statement statement = connection.createStatement()) {
            try (ResultSet rs = statement.executeQuery(
                    "SELECT @@session.time_zone, @@global.time_zone, "
                            + "@@system_time_zone, "
                            + "CAST(CURRENT_TIMESTAMP AS CHAR)")) {
                rs.next();
                sessionTz = rs.getString(1);
                globalTz = rs.getString(2);
                systemTz = rs.getString(3);
                raw = rs.getString(4);
            }
            dbNow = JdbcRepositorySupport.databaseNow(connection);
            jvmNow = Instant.now();
        }
        System.out.println("[" + label + "] jvm.tz="
                + TimeZone.getDefault().getID() + " session.time_zone="
                + sessionTz + " global=" + globalTz + " system="
                + systemTz);
        System.out.println("[" + label + "] CURRENT_TIMESTAMP (text) = "
                + raw);
        System.out.println("[" + label + "] databaseNow()            = "
                + dbNow);
        System.out.println("[" + label + "] Instant.now()            = "
                + jvmNow);
        System.out.println("[" + label + "] databaseNow - real clock = "
                + Duration.between(jvmNow, dbNow).toSeconds() + " s");
        System.out.println("[" + label + "] sub-second digits of db clock = "
                + dbNow.getNano());

        JdbcRuntimeBindingRepository repo =
                new JdbcRuntimeBindingRepository(ds);
        RuntimeBindingRecord created = repo.findOrCreate(request(
                "single-" + label + "-" + System.nanoTime()));
        System.out.println("[" + label + "] findOrCreate().lastActiveAt - "
                + "real clock = " + Duration.between(Instant.now(),
                        created.getLastActiveAt()).toSeconds() + " s");
        RuntimeBindingRecord claimed = repo.claimOperation(
                created.getBindingId(), "owner", Duration.ofMinutes(30));
        System.out.println("[" + label + "] claimOperation(PT30M)"
                + ".operationLeaseUntil - real clock = "
                + Duration.between(Instant.now(),
                        claimed.getOperationLeaseUntil()).toSeconds()
                + " s   (expected ~1800)");
    }

    private static void claim(SimpleDs ds, String key, String owner,
            long seconds) {
        JdbcRuntimeBindingRepository repo =
                new JdbcRuntimeBindingRepository(ds);
        RuntimeBindingRecord binding = repo.findOrCreate(request(key));
        RuntimeBindingRecord claimed = repo.claimOperation(
                binding.getBindingId(), owner, Duration.ofSeconds(seconds));
        print(owner, "claimOperation(" + seconds + "s)", claimed);
    }

    private static void renew(SimpleDs ds, String key, String owner,
            long generation, long seconds) {
        JdbcRuntimeBindingRepository repo =
                new JdbcRuntimeBindingRepository(ds);
        RuntimeBindingRecord binding = repo.findOrCreate(request(key));
        RuntimeBindingRecord renewed = repo.renewOperation(
                binding.getBindingId(), owner, generation,
                Duration.ofSeconds(seconds));
        print(owner, "renewOperation(gen=" + generation + ")", renewed);
    }

    private static void print(String owner, String what,
            RuntimeBindingRecord record) {
        if (record == null) {
            System.out.println("  " + owner + " " + what
                    + " -> null (fenced / rejected)");
        } else {
            System.out.println("  " + owner + " " + what + " -> GRANTED owner="
                    + record.getOperationOwner() + " operationGeneration="
                    + record.getOperationGeneration() + " leaseUntil="
                    + record.getOperationLeaseUntil() + " (real now="
                    + Instant.now() + ")");
        }
    }
}
