// Standalone Broker initializer on a real engine: JdbcRuntimeBrokerSchema.initialize
// (delegates to ManagedSchema.initialize), then the ledger table's indexes.
import com.alibaba.qwen.code.runtimebroker.JdbcRuntimeBrokerSchema;
import com.mysql.cj.jdbc.MysqlDataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

public class ProbeInit3 {
    public static void main(String[] args) throws Exception {
        MysqlDataSource ds = new MysqlDataSource();
        ds.setURL(args[1]);
        ds.setUser("root");
        ds.setPassword("r13986");
        try {
            JdbcRuntimeBrokerSchema.initialize(ds);
            System.out.print("initialize OK; ");
        } catch (RuntimeException e) {
            Throwable root = e;
            while (root.getCause() != null) root = root.getCause();
            System.out.print("initialize REFUSED: " + e.getMessage() + " <- " + root.getMessage() + "; ");
        }
        try (Connection c = ds.getConnection();
                PreparedStatement s = c.prepareStatement("SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) "
                        + "FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'ma_tool_execution' "
                        + "AND index_name = 'idx_tool_execution_harness' GROUP BY index_name");
                ResultSet r = s.executeQuery()) {
            System.out.println(r.next() ? "index " + r.getString(1) + "(" + r.getString(2) + ")" : "no idx_tool_execution_harness");
        }
    }
}
