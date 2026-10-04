import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

// PR #13365 lock probe: replays the exact admission SQL sequences of
// ManagedAgentStore (base vs head vs candidate) on MySQL InnoDB, with
// barriers so the interleaving is deterministic.
//
//   java -cp mysql-connector-j.jar LockProbe.java <jdbcUrl> <mode> <variant> <n> <reps>
//
// modes:
//   scope-same   one winner + (n-1) losers on ONE idempotency key
//   scope-diff   n distinct keys, same tenant, all admitted together
//   turn-diff    n distinct SUBMIT_TURN keys: replay probe, then insert
// variants (scope): old = ODKU + FOR UPDATE (base), new = INSERT, on dup FOR UPDATE (head),
//                   share = INSERT, on dup FOR SHARE (candidate)
// variants (turn):  old = probe FOR UPDATE (base), new = plain probe (head)
public class LockProbe {
    static String url;

    public static void main(String[] a) throws Exception {
        url = a[0];
        String mode = a[1], variant = a[2];
        int n = Integer.parseInt(a[3]), reps = Integer.parseInt(a[4]);
        try (Connection c = DriverManager.getConnection(url, "root", "")) {
            Statement s = c.createStatement();
            s.execute("CREATE TABLE IF NOT EXISTS managed_session_create_scope ("
                    + " tenant_id VARCHAR(128) NOT NULL, idempotency_key VARCHAR(128) NOT NULL,"
                    + " workspace_bound BOOLEAN NOT NULL, PRIMARY KEY (tenant_id, idempotency_key))"
                    + " DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
            s.execute("CREATE TABLE IF NOT EXISTS managed_agent_command ("
                    + " tenant_id VARCHAR(128) NOT NULL, operation VARCHAR(32) NOT NULL,"
                    + " idempotency_key VARCHAR(128) NOT NULL, request_digest VARCHAR(71) NOT NULL,"
                    + " session_id VARCHAR(64) NOT NULL, PRIMARY KEY (tenant_id, operation, idempotency_key))"
                    + " DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
            // Neighbour rows so the probed keys land inside a gap, as in a live table.
            s.execute("INSERT IGNORE INTO managed_session_create_scope VALUES ('a-tenant','k',0),('z-tenant','k',0)");
            s.execute("INSERT IGNORE INTO managed_agent_command VALUES ('a-tenant','SUBMIT_TURN','k','d','s'),('z-tenant','SUBMIT_TURN','k','d','s')");
        }
        Map<String, Integer> totals = new TreeMap<>();
        int repsWithDeadlock = 0;
        for (int r = 0; r < reps; r++) {
            String tenant = "probe-" + UUID.randomUUID();
            List<String> outcomes = switch (mode) {
                case "scope-same" -> scopeSame(tenant, variant, n);
                case "scope-diff" -> scopeDiff(tenant, variant, n);
                case "turn-diff" -> turnDiff(tenant, variant, n);
                default -> throw new IllegalArgumentException(mode);
            };
            boolean dl = false;
            for (String o : outcomes) {
                totals.merge(o, 1, Integer::sum);
                dl |= o.startsWith("deadlock");
            }
            if (dl) repsWithDeadlock++;
            if (r == 0) System.out.println("  rep0 " + outcomes);
        }
        System.out.printf("RESULT mode=%s variant=%s n=%d reps=%d repsWithDeadlock=%d outcomes=%s%n",
                mode, variant, n, reps, repsWithDeadlock, totals);
    }

    static Connection tx() throws SQLException {
        Connection c = DriverManager.getConnection(url, "root", "");
        c.setAutoCommit(false);
        c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
        try (Statement s = c.createStatement()) {
            s.execute("SET SESSION innodb_lock_wait_timeout = 10");
        }
        return c;
    }

    static String classify(SQLException e) {
        if (e.getErrorCode() == 1213) return "deadlock";
        if (e.getErrorCode() == 1205) return "lock-timeout";
        if (e.getErrorCode() == 1062) return "dup";
        return "sql-" + e.getErrorCode();
    }

    static int lockWaits(Connection mon) throws SQLException {
        try (ResultSet rs = mon.createStatement().executeQuery(
                "SELECT COUNT(*) FROM information_schema.innodb_trx t JOIN information_schema.processlist p"
                        + " ON p.id = t.trx_mysql_thread_id WHERE t.trx_state = 'LOCK WAIT' AND p.db = DATABASE()")) {
            rs.next();
            return rs.getInt(1);
        }
    }

    // The scope step exactly as requireCreationScope runs it, inside the caller's transaction.
    static String scopeStep(Connection c, String variant, String tenant, String key) throws SQLException {
        if (variant.equals("old")) {
            try (PreparedStatement p = c.prepareStatement("INSERT INTO managed_session_create_scope"
                    + " (tenant_id, idempotency_key, workspace_bound) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE"
                    + " workspace_bound = workspace_bound")) {
                p.setString(1, tenant); p.setString(2, key); p.setBoolean(3, false);
                p.executeUpdate();
            }
            reread(c, tenant, key, " FOR UPDATE");
            return "ok";
        }
        try (PreparedStatement p = c.prepareStatement("INSERT INTO managed_session_create_scope"
                + " (tenant_id, idempotency_key, workspace_bound) VALUES (?, ?, ?)")) {
            p.setString(1, tenant); p.setString(2, key); p.setBoolean(3, false);
            p.executeUpdate();
            return "inserted";
        } catch (SQLException e) {
            if (e.getErrorCode() != 1062) throw e;
        }
        reread(c, tenant, key, variant.equals("share") ? " FOR SHARE" : " FOR UPDATE");
        return "dup-then-reread";
    }

    static void reread(Connection c, String tenant, String key, String lock) throws SQLException {
        try (PreparedStatement p = c.prepareStatement("SELECT workspace_bound FROM managed_session_create_scope"
                + " WHERE tenant_id = ? AND idempotency_key = ?" + lock)) {
            p.setString(1, tenant); p.setString(2, key);
            try (ResultSet rs = p.executeQuery()) {
                if (!rs.next()) throw new IllegalStateException("scope row missing");
            }
        }
    }

    static List<String> scopeSame(String tenant, String variant, int n) throws Exception {
        String key = UUID.randomUUID().toString();
        ExecutorService pool = Executors.newFixedThreadPool(n);
        try (Connection mon = DriverManager.getConnection(url, "root", "")) {
            Connection winner = tx();
            String first = scopeStep(winner, variant, tenant, key);
            List<Future<String>> losers = new ArrayList<>();
            for (int i = 1; i < n; i++) {
                losers.add(pool.submit(() -> {
                    if (System.getenv("PROBE_DEBUG") != null) System.out.println("  dbg loser start " + Thread.currentThread().getName());
                    try (Connection c = tx()) {
                        if (System.getenv("PROBE_DEBUG") != null) System.out.println("  dbg loser connected");
                        try {
                            String r = scopeStep(c, variant, tenant, key);
                            c.commit();
                            return r;
                        } catch (SQLException e) {
                            c.rollback();
                            return classify(e);
                        }
                    }
                }));
            }
            long until = System.currentTimeMillis() + 10000;
            while (lockWaits(mon) < n - 1 && System.currentTimeMillis() < until) Thread.sleep(150); // innodb_trx refreshes only after >100 ms without reads
            int queued = lockWaits(mon);
            if (System.getenv("PROBE_DEBUG") != null) { try (ResultSet rs = mon.createStatement().executeQuery("SELECT t.trx_state, p.db, DATABASE(), p.id, t.trx_query FROM information_schema.innodb_trx t LEFT JOIN information_schema.processlist p ON p.id = t.trx_mysql_thread_id")) { while (rs.next()) System.out.println("  dbg " + rs.getString(1) + " | " + rs.getString(2) + " | " + rs.getString(3) + " | " + rs.getString(5)); } try (ResultSet rs = mon.createStatement().executeQuery("SELECT id, command, state, info FROM information_schema.processlist WHERE db = DATABASE()")) { while (rs.next()) System.out.println("  plist " + rs.getString(1) + " | " + rs.getString(2) + " | " + rs.getString(3) + " | " + rs.getString(4)); } }
            winner.commit();
            winner.close();
            List<String> out = new ArrayList<>();
            out.add("winner:" + first);
            for (Future<String> f : losers) out.add(f.get(30, TimeUnit.SECONDS));
            if (queued != n - 1) out.add("queued-only-" + queued);
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    static List<String> scopeDiff(String tenant, String variant, int n) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CyclicBarrier start = new CyclicBarrier(n), stepped = new CyclicBarrier(n);
        try {
            List<Future<String>> fs = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                fs.add(pool.submit(() -> {
                    try (Connection c = tx()) {
                        start.await(10, TimeUnit.SECONDS);
                        try {
                            String r = scopeStep(c, variant, tenant, UUID.randomUUID().toString());
                            try { stepped.await(3, TimeUnit.SECONDS); } catch (Exception ignored) { }
                            c.commit();
                            return r;
                        } catch (SQLException e) {
                            c.rollback();
                            return classify(e);
                        }
                    }
                }));
            }
            List<String> out = new ArrayList<>();
            for (Future<String> f : fs) out.add(f.get(60, TimeUnit.SECONDS));
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    // insertTurnCommand's replay probe followed by insertCommand, per Turn.
    static List<String> turnDiff(String tenant, String variant, int n) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CyclicBarrier start = new CyclicBarrier(n), probed = new CyclicBarrier(n);
        try {
            List<Future<String>> fs = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                fs.add(pool.submit(() -> {
                    String key = UUID.randomUUID().toString();
                    try (Connection c = tx()) {
                        start.await(10, TimeUnit.SECONDS);
                        try {
                            try (PreparedStatement p = c.prepareStatement("SELECT request_digest FROM managed_agent_command"
                                    + " WHERE tenant_id = ? AND operation = 'SUBMIT_TURN' AND idempotency_key = ?"
                                    + (variant.equals("old") ? " FOR UPDATE" : ""))) {
                                p.setString(1, tenant); p.setString(2, key);
                                p.executeQuery().close();
                            }
                            try { probed.await(3, TimeUnit.SECONDS); } catch (Exception ignored) { }
                            try (PreparedStatement p = c.prepareStatement("INSERT INTO managed_agent_command"
                                    + " VALUES (?, 'SUBMIT_TURN', ?, 'digest', 'session')")) {
                                p.setString(1, tenant); p.setString(2, key);
                                p.executeUpdate();
                            }
                            c.commit();
                            return "ok";
                        } catch (SQLException e) {
                            c.rollback();
                            return classify(e);
                        }
                    }
                }));
            }
            List<String> out = new ArrayList<>();
            for (Future<String> f : fs) out.add(f.get(60, TimeUnit.SECONDS));
            return out;
        } finally {
            pool.shutdownNow();
        }
    }
}
