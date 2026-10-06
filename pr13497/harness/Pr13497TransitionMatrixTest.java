package com.alibaba.qwen.code.managedagent;

import com.alibaba.qwen.code.managedagent.store.ChannelDeliveryRepository;
import com.alibaba.qwen.code.managedagent.store.ChannelDeliveryRepository.ChannelDelivery;
import com.alibaba.qwen.code.managedagent.store.JdbcChannelDeliveryRepository;
import com.alibaba.qwen.code.managedagent.store.ManagedExtensionRecords;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * PR #13497 verification probe (not part of the PR): drives every ordered
 * pair of channel delivery states through JdbcChannelDeliveryRepository and
 * compares commit/refuse with the shared H0b delivery line.
 */
class Pr13497TransitionMatrixTest {
    private static final Map<String, List<String>> PATH = Map.of(
            "planned", List.of(),
            "sending", List.of("sending"),
            "partial", List.of("sending", "partial"),
            "delivered", List.of("sending", "delivered"),
            "unknown", List.of("sending", "unknown"),
            "rejected", List.of("sending", "rejected"),
            "cancelled", List.of("cancelled"));

    @Test
    void matrix() throws Exception {
        String arm = System.getProperty("probe.arm", "h2");
        DataSource ds;
        if (arm.equals("h2")) {
            JdbcDataSource h2 = new JdbcDataSource();
            h2.setURL("jdbc:h2:mem:matrix-" + UUID.randomUUID()
                    + ";MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
            ds = h2;
        } else {
            String url = System.getProperty("probe.url");
            String schema = "pr13497_matrix_" + arm + "_" + System.currentTimeMillis();
            new JdbcTemplate(new DriverManagerDataSource(url, "root", "pr13497"))
                    .execute("CREATE DATABASE " + schema);
            ds = new DriverManagerDataSource(url.replaceFirst("/[^/?]*(?=\\?|$)",
                    "/" + schema), "root", "pr13497");
        }
        Flyway.configure().dataSource(ds).locations("classpath:db/migration")
                .load().migrate();
        JdbcChannelDeliveryRepository repo =
                new JdbcChannelDeliveryRepository(new JdbcTemplate(ds));
        List<String> states = ChannelDeliveryRepository.DELIVERY_STATES;
        Map<String, List<String>> line = ManagedExtensionRecords.TRANSITIONS
                .get("delivery");
        int legalCommitted = 0;
        int legalTotal = 0;
        int illegalRefused = 0;
        int illegalTotal = 0;
        List<String> mismatches = new ArrayList<>();
        List<String> legalPairs = new ArrayList<>();
        int n = 0;
        for (String from : states) {
            for (String to : states) {
                String id = "m-" + n++;
                repo.findOrCreate(new ChannelDelivery("matrix", "chan", id, "seg",
                        0, "planned", null, 0, 0));
                String at = "planned";
                for (String step : PATH.get(from)) {
                    if (repo.transition("matrix", "chan", id, at, step, null) == null) {
                        throw new IllegalStateException("setup " + at + "->" + step);
                    }
                    at = step;
                }
                boolean expected = line.getOrDefault(from, List.of()).contains(to);
                boolean committed;
                try {
                    ChannelDelivery row = repo.transition("matrix", "chan", id,
                            from, to, "receipt-" + id);
                    committed = row != null && row.state().equals(to)
                            && repo.find("matrix", "chan", id).orElseThrow()
                                    .state().equals(to);
                } catch (IllegalArgumentException refused) {
                    committed = false;
                }
                String stored = repo.find("matrix", "chan", id).orElseThrow().state();
                if (expected) {
                    legalTotal++;
                    legalPairs.add(from + "->" + to);
                    if (committed) {
                        legalCommitted++;
                    }
                } else {
                    illegalTotal++;
                    if (!committed && stored.equals(from)) {
                        illegalRefused++;
                    }
                }
                if (expected != committed) {
                    mismatches.add(from + "->" + to);
                }
            }
        }
        try (PrintWriter out = new PrintWriter(new FileWriter(System.getProperty(
                "probe.out"), true), true)) {
            out.println("RESULT\t" + arm + "\tmatrix legal committed\t"
                    + legalCommitted + "/" + legalTotal + " " + legalPairs);
            out.println("RESULT\t" + arm + "\tmatrix illegal refused, row unchanged\t"
                    + illegalRefused + "/" + illegalTotal);
            out.println("RESULT\t" + arm + "\tmatrix mismatches\t"
                    + (mismatches.isEmpty() ? "none" : mismatches));
        }
    }
}
