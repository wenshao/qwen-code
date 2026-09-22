package com.alibaba.qwen.code.runtimebroker;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;

/** Does findByExecutionCallId / claimDispatch match a different execution id under the server's default collation? */
public class CollationProbe {
    static String o(Supplier<Object> s) {
        try {
            Object v = s.get();
            if (v instanceof ToolExecutionRecord r) return "record id=" + r.getExecutionCallId().replaceAll("^[0-9a-f]{6}-", "") + " " + r.getState();
            return String.valueOf(v);
        } catch (RuntimeException e) { return e.getClass().getSimpleName() + ": " + e.getMessage(); }
    }

    static ToolExecutionRecord cand(String id, String key) {
        return ToolExecutionRecord.prepared(id, key, "b", 1, "h", "rs", "t", "c", "d",
                Map.of("sessionId", "rs", "promptId", "t", "callId", "c", "argsDigest", "d"));
    }

    public static void main(String[] a) {
        String p = UUID.randomUUID().toString().substring(0, 6) + "-";
        DataSource ds;
        ToolExecutionRepository repo;
        if (a[0].equals("in-memory")) { repo = new InMemoryToolExecutionRepository(); }
        else if (a[0].equals("h2")) {
            JdbcDataSource h2 = new JdbcDataSource();
            h2.setURL("jdbc:h2:mem:c;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
            JdbcRuntimeBrokerSchema.initialize(h2); repo = new JdbcToolExecutionRepository(h2);
        } else {
            ds = new DriverManagerDataSource(a[0], "root", ""); JdbcRuntimeBrokerSchema.initialize(ds); repo = new JdbcToolExecutionRepository(ds);
        }
        ToolExecutionRepository r = repo;
        r.findOrCreate(cand(p + "exec-a", p + "key-1"));
        System.out.println("arm=" + a[a.length - 1]);
        System.out.println("  findByExecutionCallId(\"EXEC-A\")         -> " + o(() -> r.findByExecutionCallId(p + "EXEC-A")));
        System.out.println("  findByExecutionCallId(\"exéc-a\")         -> " + o(() -> r.findByExecutionCallId(p + "exéc-a")));
        System.out.println("  findByExecutionCallId(\"exec-a \")        -> " + o(() -> r.findByExecutionCallId(p + "exec-a ")));
        System.out.println("  claimDispatch(\"EXEC-A\", owner)          -> " + o(() -> r.claimDispatch(p + "EXEC-A", "owner", Duration.ofMinutes(1))));
        System.out.println("  findOrCreate(id \"EXEC-A\", other key)    -> " + o(() -> r.findOrCreate(cand(p + "EXEC-A", p + "key-2"))));
    }
}
