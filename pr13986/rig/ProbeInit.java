// Real-engine probe of the shipped runtime-broker classes (public API only).
//   init  <url>        JdbcRuntimeBrokerSchema.initialize, then list the
//                      ledger table's indexes and its collation
//   alias <url>        two hold rows whose Harness ids differ only in case;
//                      findHoldRowsByHarnessSession(lower-case id)
import com.alibaba.qwen.code.runtimebroker.JdbcRuntimeBrokerSchema;
import com.mysql.cj.jdbc.MysqlDataSource;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.HexFormat;
import java.util.List;

public class ProbeInit {
    static String key(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
        digest.update(bytes);
        return HexFormat.of().formatHex(digest.digest());
    }

    static void insertHold(Connection c, String harness, String runtime, String call) throws Exception {
        try (PreparedStatement s = c.prepareStatement("INSERT INTO qwen_tool_execution (execution_call_id_hash, execution_call_id, "
                + "idempotency_key_hash, idempotency_key, binding_id, runtime_generation, harness_session_id, runtime_session_id, "
                + "runtime_session_key, turn_id, tool_call_id, request_digest, reference_json, execution_state, execution_status, "
                + "last_sequence, cancel_requested, dispatch_generation, record_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")) {
            s.setString(1, key(call)); s.setString(2, call);
            s.setString(3, key("idem-" + call)); s.setString(4, "idem-" + call);
            s.setString(5, "binding-1"); s.setLong(6, 1);
            s.setString(7, harness); s.setString(8, runtime); s.setString(9, key(runtime));
            s.setString(10, "turn-" + call); s.setString(11, "tool-" + call); s.setString(12, "sha256:0");
            s.setString(13, "{\"dispatchMode\":\"background_v3_process\",\"sessionId\":\"" + runtime + "\",\"promptId\":\"turn-" + call + "\",\"callId\":\"tool-" + call + "\",\"argsDigest\":\"sha256:0\"}");
            s.setString(14, "PREPARED"); s.setString(15, null);
            s.setLong(16, 0); s.setBoolean(17, false); s.setLong(18, 0); s.setLong(19, 1);
            s.executeUpdate();
        }
    }

    public static void main(String[] args) throws Exception {
        String mode = args[0];
        MysqlDataSource ds = new MysqlDataSource();
        ds.setURL(args[1]);
        ds.setUser("root");
        ds.setPassword(args.length > 2 ? args[2] : "r13986");
        if (mode.equals("init")) {
            JdbcRuntimeBrokerSchema.initialize(ds);
            try (Connection c = ds.getConnection();
                    PreparedStatement s = c.prepareStatement("SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) "
                            + "FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'qwen_tool_execution' "
                            + "GROUP BY index_name ORDER BY index_name");
                    ResultSet r = s.executeQuery()) {
                StringBuilder out = new StringBuilder("indexes:");
                while (r.next()) out.append(' ').append(r.getString(1)).append('(').append(r.getString(2)).append(')');
                System.out.println(out);
            }
            try (Connection c = ds.getConnection();
                    PreparedStatement s = c.prepareStatement("SELECT collation_name FROM information_schema.columns WHERE table_schema = DATABASE() "
                            + "AND table_name = 'qwen_tool_execution' AND column_name = 'harness_session_id'");
                    ResultSet r = s.executeQuery()) {
                r.next();
                System.out.println("harness_session_id collation: " + r.getString(1));
            }
        }
    }
}
