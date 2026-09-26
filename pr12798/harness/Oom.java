import com.alibaba.qwen.code.runtimebroker.*;
import java.math.BigDecimal;
import java.util.*;
import org.h2.jdbcx.JdbcDataSource;
public class Oom {
    public static void main(String[] a) {
        JdbcDataSource ds = new JdbcDataSource();
        ds.setURL("jdbc:h2:mem:oom;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        JdbcRuntimeBrokerSchema.initialize(ds);
        for (String lit : new String[]{"1E+2000000000", "1E+300000000"}) {
            Map<String, Object> ref = new LinkedHashMap<>();
            ref.put("sessionId", "rs"); ref.put("promptId", "t"); ref.put("callId", "c"); ref.put("argsDigest", "d");
            ref.put("v", new BigDecimal(lit));
            String stage = "construct";
            long t0 = System.nanoTime();
            try {
                ToolExecutionRecord r = ToolExecutionRecord.prepared("e-" + lit, "k-" + lit, "b", 1, "h", "rs", "t", "c", "d", ref);
                stage = "findOrCreate";
                new JdbcToolExecutionRepository(ds).findOrCreate(r);
                System.out.printf("%s: construct OK, write OK (%d ms)%n", lit, (System.nanoTime()-t0)/1000000);
            } catch (Throwable t) {
                System.out.printf("%s: construct %s, %s -> %s: %s (%d ms)%n", lit, stage.equals("construct") ? "THROWS" : "OK",
                    stage, t.getClass().getName(), t.getMessage(), (System.nanoTime()-t0)/1000000);
            }
        }
        try (var c = ds.getConnection(); var s = c.createStatement(); var r = s.executeQuery("SELECT COUNT(*) FROM qwen_tool_execution")) { r.next(); System.out.println("rows in qwen_tool_execution: " + r.getLong(1)); } catch (Exception e) { throw new RuntimeException(e); }
    }
}
