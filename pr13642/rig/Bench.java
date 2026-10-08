package com.alibaba.qwen.code.runtimebroker;

import java.sql.Connection;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Placement admission cost with N historical terminal rows in one tenant (same source, compiled per arm). */
public final class Bench {
    static final AtomicLong DECRYPTS = new AtomicLong();
    static String nextId;

    public static void main(String[] args) throws Exception {
        DataSource source = new DriverManagerDataSource(args[1], "root", "pr13642");
        SecretProtector real = AesGcmSecretProtector.fromBase64("k1", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
        SecretProtector counting = new SecretProtector() {
            public ProtectedSecret protect(String context, byte[] plaintext) { return real.protect(context, plaintext); }
            public byte[] unprotect(String context, ProtectedSecret secret) {
                DECRYPTS.incrementAndGet();
                return real.unprotect(context, secret);
            }
        };
        var bindings = new JdbcRuntimeBindingRepository(source, counting, () -> nextId);
        if ("seedreal".equals(args[0])) {
            seedReal(source, bindings, Integer.parseInt(args[2]));
        } else if ("seed".equals(args[0])) {
            seed(source, bindings, Integer.parseInt(args[2]));
        } else {
            measure(bindings, Integer.parseInt(args[2]), args[3]);
        }
    }

    static RuntimeProvisionRequest request(String id, String kind, String storage) {
        return new RuntimeProvisionRequest(new RuntimeScope("tenant-bench", "ws-" + id, "1", "/workspace/" + id,
                "sha256:" + "a".repeat(64), "session"), "harness-" + id, kind, storage);
    }

    static void seed(DataSource source, JdbcRuntimeBindingRepository bindings, int n) throws Exception {
        nextId = "tpl-failed";
        bindings.findOrCreate(request("tpl-failed", "legacy", null));
        nextId = "tpl-blocked";
        RuntimeBindingRecord blocked = bindings.findOrCreate(request("tpl-blocked", "local-process", "storage-tpl"));
        try (Connection c = source.getConnection(); var st = c.createStatement()) {
            st.executeUpdate("UPDATE qwen_runtime_binding SET binding_state = 'FAILED' WHERE binding_id = 'tpl-failed'");
            st.executeUpdate("UPDATE qwen_runtime_binding SET binding_state = 'RECOVERY_BLOCKED' WHERE binding_id = 'tpl-blocked'");
            st.executeUpdate("UPDATE qwen_runtime_binding_slot SET active_binding_id = NULL");
            List<String> columns = new ArrayList<>();
            try (ResultSet rs = st.executeQuery("SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE()"
                    + " AND table_name = 'qwen_runtime_binding' ORDER BY ordinal_position")) {
                while (rs.next()) columns.add(rs.getString(1));
            }
            List<String> select = new ArrayList<>();
            for (String col : columns) {
                switch (col.toLowerCase()) {
                    case "binding_id" -> select.add("CONCAT(binding_id, '-', s.n)");
                    case "request_key" -> select.add("SHA2(CONCAT(binding_id, '-', s.n), 256)");
                    case "workspace_id" -> select.add("CONCAT(workspace_id, '-', s.n)");
                    case "canonical_cwd" -> select.add("CONCAT(canonical_cwd, '-', s.n)");
                    case "storage_id" -> select.add("IF(storage_id IS NULL, NULL, CONCAT(storage_id, '-', s.n))");
                    default -> select.add(col);
                }
            }
            st.executeUpdate("SET SESSION cte_max_recursion_depth = 1000000");
            String sql = "INSERT INTO qwen_runtime_binding (" + String.join(", ", columns) + ") "
                    + "WITH RECURSIVE s (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < " + (n / 2) + ") "
                    + "SELECT " + String.join(", ", select) + " FROM qwen_runtime_binding, s WHERE binding_id IN ('tpl-failed', 'tpl-blocked')";
            int inserted = n == 0 ? 0 : st.executeUpdate(sql);
            try (ResultSet rs = st.executeQuery("SELECT binding_state, COUNT(*), SUM(provision_seed_ciphertext IS NOT NULL)"
                    + " FROM qwen_runtime_binding WHERE tenant_id = 'tenant-bench' GROUP BY binding_state")) {
                while (rs.next()) System.out.println("seeded " + rs.getString(1) + " rows=" + rs.getInt(2) + " with_seed_ciphertext=" + rs.getInt(3));
            }
            System.out.println("inserted=" + inserted + " template-seed=" + (blocked.getProvisionSeed() != null));
        }
    }

    static void seedReal(DataSource source, JdbcRuntimeBindingRepository bindings, int n) throws Exception {
        for (int i = 0; i < n; i++) {
            boolean blocked = i % 2 == 1;
            String id = (blocked ? "hist-blocked-" : "hist-failed-") + i;
            nextId = id;
            bindings.findOrCreate(request(id, blocked ? "local-process" : "legacy", blocked ? "storage-" + i : null));
        }
        try (Connection c = source.getConnection(); var st = c.createStatement()) {
            st.executeUpdate("UPDATE qwen_runtime_binding SET binding_state = 'FAILED' WHERE binding_id LIKE 'hist-failed-%'");
            st.executeUpdate("UPDATE qwen_runtime_binding SET binding_state = 'RECOVERY_BLOCKED' WHERE binding_id LIKE 'hist-blocked-%'");
            st.executeUpdate("UPDATE qwen_runtime_binding_slot SET active_binding_id = NULL");
            try (ResultSet rs = st.executeQuery("SELECT binding_state, COUNT(*), SUM(provision_seed_ciphertext IS NOT NULL)"
                    + " FROM qwen_runtime_binding WHERE tenant_id = 'tenant-bench' GROUP BY binding_state")) {
                while (rs.next()) System.out.println("seeded " + rs.getString(1) + " rows=" + rs.getInt(2) + " with_seed_ciphertext=" + rs.getInt(3));
            }
        }
    }

    static void measure(JdbcRuntimeBindingRepository bindings, int k, String label) {
        long[] micros = new long[k];
        DECRYPTS.set(0);
        for (int i = 0; i < k + 3; i++) {
            String id = label + "-probe-" + i + "-" + System.nanoTime();
            nextId = id;
            long start = System.nanoTime();
            bindings.findOrCreate(request(id, "legacy", null));
            long took = (System.nanoTime() - start) / 1000;
            if (i >= 3) micros[i - 3] = took;  // 3 warm-ups
        }
        long decrypts = DECRYPTS.get();
        Arrays.sort(micros);
        System.out.printf("%s admissions=%d median_ms=%.2f p90_ms=%.2f decrypts_per_admission=%.1f%n", label, k,
                micros[k / 2] / 1000.0, micros[(int) (k * 0.9)] / 1000.0, decrypts / (double) (k + 3));
    }
}
