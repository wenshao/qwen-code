package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.store.ChannelDeliveryRepository.ChannelDelivery;
import com.alibaba.qwen.code.managedagent.store.ChannelRouteRepository;
import com.alibaba.qwen.code.managedagent.store.ChannelRouteRepository.ChannelRoute;
import com.alibaba.qwen.code.managedagent.store.JdbcChannelDeliveryRepository;
import com.alibaba.qwen.code.managedagent.store.JdbcChannelRouteRepository;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * PR #13497 verification probe (not part of the PR). Runs the PR's own
 * ManagedChannelJdbcContract plus real-database probes against the database
 * named by -Dprobe.url (or H2 in MySQL mode when probe.arm=h2).
 */
class Pr13497RealDbProbeTest {
    private static final String SESSION = "6f1c7d7e-3a4b-4c2d-9e8f-0123456789ab";
    private static final int THREADS = 32;
    private static final int ROUNDS = 5;

    private PrintWriter out;
    private String arm;

    @Test
    void probe() throws Exception {
        arm = System.getProperty("probe.arm", "h2");
        String only = System.getProperty("probe.only", "all");
        out = new PrintWriter(new FileWriter(System.getProperty("probe.out",
                "probe-" + arm + ".tsv"), true), true);
        try {
            DataSource ds = freshDatabase();
            JdbcTemplate jdbc = new JdbcTemplate(ds);
            migrate(ds, jdbc);
            if (only.equals("migrate")) {
                return;
            }
            contract(ds);
            if (only.equals("contract")) {
                return;
            }
            caseAndPad(jdbc);
            concurrency(jdbc);
            receiptKeep(jdbc);
            clockAndUnicode(jdbc);
            explain(jdbc);
        } finally {
            out.close();
        }
    }

    private void result(String probe, Object value) {
        String line = "RESULT\t" + arm + "\t" + probe + "\t" + value;
        System.out.println(line);
        out.println(line);
    }

    private DataSource freshDatabase() {
        if (arm.equals("h2")) {
            JdbcDataSource ds = new JdbcDataSource();
            ds.setURL("jdbc:h2:mem:pr13497-" + UUID.randomUUID()
                    + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
            return ds;
        }
        String url = Objects.requireNonNull(System.getProperty("probe.url"));
        String user = System.getProperty("probe.user", "root");
        String password = System.getProperty("probe.password", "");
        String schema = "pr13497_" + arm + "_" + System.currentTimeMillis();
        new JdbcTemplate(new DriverManagerDataSource(url, user, password))
                .execute("CREATE DATABASE " + schema);
        result("database", schema);
        return new DriverManagerDataSource(
                url.replaceFirst("/[^/?]*(?=\\?|$)", "/" + schema), user,
                password);
    }

    private void migrate(DataSource ds, JdbcTemplate jdbc) {
        if (!arm.equals("h2")) {
            result("server_version", jdbc.queryForObject("SELECT VERSION()",
                    String.class));
        }
        MigrateResult first = Flyway.configure().dataSource(ds)
                .locations("classpath:db/migration").target("46").load()
                .migrate();
        result("migrate_to_46", first.migrationsExecuted + " executed, now V"
                + first.targetSchemaVersion);
        MigrateResult second = Flyway.configure().dataSource(ds)
                .locations("classpath:db/migration").load().migrate();
        List<String> versions = new ArrayList<>();
        second.migrations.forEach(m -> versions.add("V" + m.version + " "
                + m.description));
        result("migrate_46_to_head", second.migrationsExecuted
                + " executed " + versions + ", now V"
                + second.targetSchemaVersion);
        result("history_rows", jdbc.queryForObject(
                "SELECT COUNT(*) FROM flyway_schema_history WHERE success = 1",
                Integer.class));
        if (!arm.equals("h2")) {
            for (Map<String, Object> row : jdbc.queryForList("SELECT TABLE_NAME,"
                    + " TABLE_COLLATION, ENGINE FROM information_schema.TABLES"
                    + " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE"
                    + " 'qwen_managed_channel_%' ORDER BY TABLE_NAME")) {
                result("table " + row.get("TABLE_NAME"), row.get("TABLE_COLLATION")
                        + " " + row.get("ENGINE"));
            }
        }
    }

    private void contract(DataSource ds) {
        long start = System.nanoTime();
        try {
            ManagedChannelJdbcContract.verify(ds, arm + "-" + UUID.randomUUID());
            result("contract", "PASS in " + (System.nanoTime() - start) / 1_000_000
                    + " ms");
        } catch (Throwable error) {
            result("contract", "FAIL " + error.getClass().getSimpleName() + ": "
                    + String.valueOf(error.getMessage()).replace('\n', ' '));
        }
    }

    private void caseAndPad(JdbcTemplate jdbc) {
        JdbcChannelDeliveryRepository deliveries =
                new JdbcChannelDeliveryRepository(jdbc);
        JdbcChannelRouteRepository routes = new JdbcChannelRouteRepository(jdbc);
        String tenant = "probe-ids";
        // Case: two delivery ids that differ only by case.
        deliveries.findOrCreate(delivery(tenant, "chan", "Delivery-A", "seg", 0));
        ChannelDelivery lower = deliveries.findOrCreate(delivery(tenant, "chan",
                "delivery-a", "seg", 0));
        result("case delivery_id rows", count(jdbc,
                "qwen_managed_channel_delivery", tenant) + " (returned id "
                + lower.deliveryId() + ")");
        // Case: two channel ids that differ only by case.
        routes.findOrCreate(route(tenant, "Chan-Case", "event-1"));
        routes.findOrCreate(route(tenant, "chan-case", "event-1"));
        result("case channel listing", "Chan-Case lists "
                + routes.listByChannel(tenant, "Chan-Case", null, 100).routes().size()
                + ", chan-case lists "
                + routes.listByChannel(tenant, "chan-case", null, 100).routes().size());
        // Trailing space: delivery id "pad-1" vs "pad-1 ".
        String padTenant = "probe-pad";
        deliveries.findOrCreate(delivery(padTenant, "chan", "pad-1", "seg", 0));
        attempt("pad delivery_id 'pad-1 '", () -> {
            ChannelDelivery spaced = deliveries.findOrCreate(delivery(padTenant,
                    "chan", "pad-1 ", "seg", 0));
            return "returned id [" + spaced.deliveryId() + "]";
        }, () -> ", rows " + count(jdbc, "qwen_managed_channel_delivery",
                padTenant));
        attempt("pad find('pad-1   ')", () -> deliveries.find(padTenant, "chan",
                "pad-1   ").map(d -> "found [" + d.deliveryId() + "]")
                .orElse("empty"), () -> "");
        attempt("pad transition('pad-1 ')", () -> {
            ChannelDelivery moved = deliveries.transition(padTenant, "chan",
                    "pad-1 ", "planned", "sending", null);
            return moved == null ? "null" : "moved [" + moved.deliveryId()
                    + "] to " + moved.state();
        }, () -> ", stored [pad-1] is " + deliveries.find(padTenant, "chan",
                "pad-1").map(ChannelDelivery::state).orElse("absent"));
        deliveries.findOrCreate(delivery(padTenant, "chan", "pad-2", "seg", 0));
        attempt("pad channel 'chan ' + same delivery id", () -> "returned channel ["
                + deliveries.findOrCreate(delivery(padTenant, "chan ", "pad-2",
                        "seg", 0)).channelInstanceId() + "]", () -> "");
        routes.findOrCreate(route(padTenant, "chan-pad", "event-1"));
        attempt("pad route create on 'chan-pad '", () -> "created on ["
                + routes.findOrCreate(route(padTenant, "chan-pad ", "event-2"))
                        .channelInstanceId() + "]", () -> "");
        attempt("pad channel listing", () -> "'chan-pad' lists "
                + routes.listByChannel(padTenant, "chan-pad", null, 100).routes().size()
                + " (channels " + channels(routes.listByChannel(padTenant,
                        "chan-pad", null, 100).routes()) + ")", () -> "");
    }

    private void attempt(String probe, java.util.function.Supplier<String> body,
            java.util.function.Supplier<String> after) {
        String value;
        try {
            value = body.get();
        } catch (RuntimeException error) {
            value = "refused " + error.getClass().getSimpleName() + ": "
                    + error.getMessage();
        }
        result(probe, value + after.get());
    }

    private static String channels(List<ChannelRoute> rows) {
        List<String> names = new ArrayList<>();
        rows.forEach(r -> names.add("[" + r.channelInstanceId() + "]"));
        return String.join(",", names);
    }

    private void concurrency(JdbcTemplate jdbc) throws Exception {
        JdbcChannelDeliveryRepository deliveries =
                new JdbcChannelDeliveryRepository(jdbc);
        JdbcChannelRouteRepository routes = new JdbcChannelRouteRepository(jdbc);
        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        String tenant = "probe-race";
        int createOk = 0;
        int createRows = 0;
        int createErrors = 0;
        int sendNonNull = 0;
        int sendErrors = 0;
        int deliverWinners = 0;
        int deliverNull = 0;
        int deliverErrors = 0;
        int receiptMatchesWinner = 0;
        int routeRows = 0;
        int routeErrors = 0;
        int admitWinners = 0;
        int admitNull = 0;
        int admitMatches = 0;
        int admitReplayNonNull = 0;
        Set<String> errorKinds = new HashSet<>();
        try {
            for (int round = 0; round < ROUNDS; round++) {
                String id = "race-" + round;
                String segment = "seg-" + round;
                List<Object> created = race(pool, i -> deliveries.findOrCreate(
                        delivery(tenant, "chan", id, segment, 0)));
                createOk += (int) created.stream().filter(o -> o instanceof ChannelDelivery).count();
                createErrors += errors(created, errorKinds);
                createRows += jdbc.queryForObject("SELECT COUNT(*) FROM"
                        + " qwen_managed_channel_delivery WHERE tenant_id = ?"
                        + " AND delivery_id = ?", Integer.class, tenant, id);

                List<Object> sent = race(pool, i -> deliveries.transition(tenant,
                        "chan", id, "planned", "sending", null));
                sendNonNull += (int) sent.stream().filter(o -> o instanceof ChannelDelivery).count();
                sendErrors += errors(sent, errorKinds);

                List<Object> delivered = race(pool, i -> deliveries.transition(
                        tenant, "chan", id, "sending", "delivered", "receipt-" + i));
                List<ChannelDelivery> winners = new ArrayList<>();
                for (Object o : delivered) {
                    if (o instanceof ChannelDelivery d) {
                        winners.add(d);
                    } else if (o == null) {
                        deliverNull++;
                    }
                }
                deliverWinners += winners.size();
                deliverErrors += errors(delivered, errorKinds);
                String stored = deliveries.find(tenant, "chan", id).orElseThrow()
                        .providerReceipt();
                if (winners.size() == 1 && stored.equals(winners.get(0)
                        .providerReceipt())) {
                    receiptMatchesWinner++;
                }

                String event = "race-event-" + round;
                List<Object> bound = race(pool, i -> routes.findOrCreate(route(
                        tenant, "chan", event)));
                routeErrors += errors(bound, errorKinds);
                String key = ChannelRouteRepository.routeKey(tenant, "chan", 1,
                        event, 1);
                routeRows += jdbc.queryForObject("SELECT COUNT(*) FROM"
                        + " qwen_managed_channel_route WHERE tenant_id = ? AND"
                        + " route_key = ?", Integer.class, tenant, key);

                List<Object> admitted = race(pool, i -> routes.admit(tenant, key,
                        "input-" + i));
                List<ChannelRoute> admitWin = new ArrayList<>();
                for (Object o : admitted) {
                    if (o instanceof ChannelRoute r) {
                        admitWin.add(r);
                    } else if (o == null) {
                        admitNull++;
                    }
                }
                errors(admitted, errorKinds);
                admitWinners += admitWin.size();
                if (admitWin.size() == 1 && routes.find(tenant, key).orElseThrow()
                        .inputId().equals(admitWin.get(0).inputId())) {
                    admitMatches++;
                }
                String winnerInput = routes.find(tenant, key).orElseThrow().inputId();
                List<Object> replays = race(pool, i -> routes.admit(tenant, key,
                        winnerInput));
                admitReplayNonNull += (int) replays.stream()
                        .filter(o -> o instanceof ChannelRoute).count();
            }
        } finally {
            pool.shutdownNow();
        }
        int total = THREADS * ROUNDS;
        result("race findOrCreate same deliveryId", "rows/round "
                + createRows / (double) ROUNDS + ", returned " + createOk + "/"
                + total + ", errors " + createErrors);
        result("race planned->sending (null receipt)", "non-null " + sendNonNull
                + "/" + total + ", errors " + sendErrors);
        result("race sending->delivered (32 receipts)", "winners " + deliverWinners
                + "/" + ROUNDS + " rounds, null " + deliverNull + ", errors "
                + deliverErrors + ", stored==winner " + receiptMatchesWinner + "/"
                + ROUNDS);
        result("race route findOrCreate same identity", "rows/round "
                + routeRows / (double) ROUNDS + ", errors " + routeErrors);
        result("race admit (32 inputs)", "winners " + admitWinners + "/" + ROUNDS
                + " rounds, null " + admitNull + ", stored==winner " + admitMatches
                + "/" + ROUNDS);
        result("race admit replay (same input)", "non-null " + admitReplayNonNull
                + "/" + total);
        result("race error kinds", errorKinds.isEmpty() ? "none" : errorKinds);
    }

    private interface Step {
        Object run(int index) throws Exception;
    }

    private static List<Object> race(ExecutorService pool, Step step)
            throws Exception {
        CountDownLatch ready = new CountDownLatch(THREADS);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Object>> futures = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            int index = i;
            Callable<Object> task = () -> {
                ready.countDown();
                go.await();
                try {
                    return step.run(index);
                } catch (Throwable error) {
                    return error;
                }
            };
            futures.add(pool.submit(task));
        }
        ready.await();
        go.countDown();
        List<Object> results = new ArrayList<>();
        for (Future<Object> future : futures) {
            results.add(future.get());
        }
        return results;
    }

    private static int errors(List<Object> results, Set<String> kinds) {
        int n = 0;
        for (Object o : results) {
            if (o instanceof Throwable t) {
                n++;
                kinds.add(t.getClass().getSimpleName() + ": "
                        + String.valueOf(t.getMessage()).split("\n")[0]);
            }
        }
        return n;
    }

    private void receiptKeep(JdbcTemplate jdbc) {
        JdbcChannelDeliveryRepository deliveries =
                new JdbcChannelDeliveryRepository(jdbc);
        String tenant = "probe-receipt";
        deliveries.findOrCreate(delivery(tenant, "chan", "keep-1", "seg", 0));
        deliveries.transition(tenant, "chan", "keep-1", "planned", "sending", null);
        deliveries.transition(tenant, "chan", "keep-1", "sending", "partial",
                "receipt-partial");
        deliveries.transition(tenant, "chan", "keep-1", "partial", "sending", null);
        ChannelDelivery done = deliveries.transition(tenant, "chan", "keep-1",
                "sending", "delivered", null);
        result("receipt kept across null-receipt steps", done.providerReceipt());
    }

    private void clockAndUnicode(JdbcTemplate jdbc) {
        JdbcChannelDeliveryRepository deliveries =
                new JdbcChannelDeliveryRepository(jdbc);
        JdbcChannelRouteRepository routes = new JdbcChannelRouteRepository(jdbc);
        String tenant = "probe-clock";
        int nonWholeSecond = 0;
        int inWindow = 0;
        int n = 50;
        for (int i = 0; i < n; i++) {
            long before = dbMillis(jdbc);
            ChannelDelivery d = deliveries.findOrCreate(delivery(tenant, "chan",
                    "clock-" + i, "seg", 0));
            long after = dbMillis(jdbc);
            if (d.createdAt() % 1000 != 0) {
                nonWholeSecond++;
            }
            if (before <= d.createdAt() && d.createdAt() <= after) {
                inWindow++;
            }
        }
        result("created_at sub-second", nonWholeSecond + "/" + n
                + " not on a whole second");
        result("created_at within DB clock bracket", inWindow + "/" + n);

        String emoji = "😀".repeat(512);
        ChannelRoute wide = new ChannelRoute("probe-wide", ChannelRouteRepository
                .routeKey("probe-wide", "chan", 1, emoji, 1), "chan", 1, emoji, 1,
                SESSION, emoji, emoji, emoji, "staged", null,
                List.of("été", "文件"), 0, 0);
        try {
            ChannelRoute back = routes.findOrCreate(wide);
            result("512 x 4-byte emoji ids", back.platformEventId().equals(emoji)
                    && back.senderId().equals(emoji) && back.threadId().equals(emoji)
                    && back.stagedAttachmentRefs().equals(wide.stagedAttachmentRefs())
                    ? "round-trip equal" : "MISMATCH");
        } catch (RuntimeException error) {
            result("512 x 4-byte emoji ids", "threw " + error.getClass().getSimpleName());
        }
        String tooLong = "x".repeat(513);
        try {
            routes.findOrCreate(new ChannelRoute("probe-wide", ChannelRouteRepository
                    .routeKey("probe-wide", "chan", 1, tooLong, 1), "chan", 1,
                    tooLong, 1, SESSION, "s", null, null, "staged", null,
                    List.of(), 0, 0));
            result("513-char platform_event_id", "accepted (row count "
                    + count(jdbc, "qwen_managed_channel_route", "probe-wide") + ")");
        } catch (RuntimeException error) {
            result("513-char platform_event_id", "threw "
                    + error.getClass().getSimpleName());
        }
    }

    private long dbMillis(JdbcTemplate jdbc) {
        return jdbc.queryForObject("SELECT UNIX_TIMESTAMP(),"
                + " EXTRACT(MICROSECOND FROM CURRENT_TIMESTAMP(6))",
                (row, i) -> row.getLong(1) * 1000 + row.getLong(2) / 1000);
    }

    private void explain(JdbcTemplate jdbc) {
        if (arm.equals("h2")) {
            return;
        }
        JdbcChannelDeliveryRepository deliveries =
                new JdbcChannelDeliveryRepository(jdbc);
        JdbcChannelRouteRepository routes = new JdbcChannelRouteRepository(jdbc);
        for (int c = 0; c < 4; c++) {
            for (int i = 0; i < 300; i++) {
                deliveries.findOrCreate(delivery("probe-explain", "chan-" + c,
                        "d-" + i, "seg-" + (i % 7), i % 3));
                routes.findOrCreate(route("probe-explain", "chan-" + c, "e-" + i));
            }
        }
        jdbc.execute("ANALYZE TABLE qwen_managed_channel_delivery");
        jdbc.execute("ANALYZE TABLE qwen_managed_channel_route");
        long t = jdbc.queryForObject("SELECT MAX(created_at) FROM"
                + " qwen_managed_channel_delivery", Long.class);
        explainOne(jdbc, "explain delivery page 1", "SELECT * FROM"
                + " qwen_managed_channel_delivery WHERE tenant_id = 'probe-explain'"
                + " AND channel_instance_id = 'chan-1' ORDER BY created_at DESC,"
                + " delivery_id DESC LIMIT 101");
        explainOne(jdbc, "explain delivery cursor page", "SELECT * FROM"
                + " qwen_managed_channel_delivery WHERE tenant_id = 'probe-explain'"
                + " AND channel_instance_id = 'chan-1' AND (created_at < " + t
                + " OR created_at = " + t + " AND delivery_id < 'd-200') ORDER BY"
                + " created_at DESC, delivery_id DESC LIMIT 101");
        long rt = jdbc.queryForObject("SELECT MAX(created_at) FROM"
                + " qwen_managed_channel_route", Long.class);
        explainOne(jdbc, "explain route cursor page", "SELECT * FROM"
                + " qwen_managed_channel_route WHERE tenant_id = 'probe-explain'"
                + " AND channel_instance_id = 'chan-1' AND (created_at < " + rt
                + " OR created_at = " + rt + " AND route_key < 'f') ORDER BY"
                + " created_at DESC, route_key DESC LIMIT 101");
    }

    private void explainOne(JdbcTemplate jdbc, String name, String sql) {
        for (Map<String, Object> row : jdbc.queryForList("EXPLAIN " + sql)) {
            result(name, "type=" + row.get("type") + " key=" + row.get("key")
                    + " rows=" + row.get("rows") + " Extra=" + row.get("Extra"));
        }
    }

    private static ChannelDelivery delivery(String tenant, String channel,
            String id, String segment, int ordinal) {
        return new ChannelDelivery(tenant, channel, id, segment, ordinal,
                "planned", null, 0, 0);
    }

    private static ChannelRoute route(String tenant, String channel,
            String event) {
        return new ChannelRoute(tenant, ChannelRouteRepository.routeKey(tenant,
                channel, 1, event, 1), channel, 1, event, 1, SESSION, "sender-1",
                null, null, "staged", null, List.of(), 0, 0);
    }

    private static int count(JdbcTemplate jdbc, String table, String tenant) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table
                + " WHERE tenant_id = ?", Integer.class, tenant);
    }
}
