import com.alibaba.qwen.code.runtimebroker.JdbcRuntimeBrokerSchema;
import com.mysql.cj.jdbc.MysqlDataSource;

/** Round 8: run the standalone Broker schema initializer from one jar against a real engine. */
public class StandaloneInit {
    public static void main(String[] args) throws Exception {
        MysqlDataSource source = new MysqlDataSource();
        source.setURL(args[0]);
        source.setUser("root");
        source.setPassword("pr13642");
        switch (args[1]) {
            case "init" -> {
                long started = System.nanoTime();
                JdbcRuntimeBrokerSchema.initialize(source);
                System.out.println("initialize() returned in " + (System.nanoTime() - started) / 1_000_000 + " ms");
            }
            case "lease" -> {
                try (var connection = source.getConnection(); var statement = connection.createStatement()) {
                    statement.executeUpdate("INSERT INTO managed_workspace_execution_lease"
                            + " (storage_key, holder_key, binding_id, runtime_generation, tenant_id)"
                            + " VALUES (REPEAT('a', 64), REPEAT('b', 64), 'b-upgrade', 3, 'tenant-upgrade')");
                    System.out.println("lease row written by the old schema's table");
                }
            }
            default -> throw new IllegalArgumentException(args[1]);
        }
    }
}
