// The PR's JDBC read on a real engine: three hold rows whose Harness ids differ
// only by case or a trailing space; findHoldRowsByHarnessSession(lower-case id).
import com.alibaba.qwen.code.runtimebroker.JdbcToolExecutionRepository;
import com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord;
import com.mysql.cj.jdbc.MysqlDataSource;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.HexFormat;
import java.util.List;

public class Probe3 {
    static String key(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
        digest.update(bytes);
        return HexFormat.of().formatHex(digest.digest());
    }

    static byte[] b(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    static void insertHold(Connection c, String harness, String runtime, String call) throws Exception {
        try (PreparedStatement s = c.prepareStatement("INSERT INTO ma_tool_execution (execution_call_id_hash, execution_call_id, "
                + "idempotency_key_hash, idempotency_key, binding_id, runtime_generation, harness_session_id, runtime_session_id, "
                + "runtime_session_key, turn_id, tool_call_id, request_digest, reference_json, execution_state, execution_status, "
                + "last_sequence, cancel_requested, dispatch_generation, record_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")) {
            s.setString(1, key(call)); s.setBytes(2, b(call));
            s.setString(3, key("idem-" + call)); s.setBytes(4, b("idem-" + call));
            s.setBytes(5, b("binding-1")); s.setLong(6, 1);
            s.setBytes(7, b(harness)); s.setBytes(8, b(runtime)); s.setString(9, key(runtime));
            s.setBytes(10, b("turn-" + call)); s.setBytes(11, b("tool-" + call)); s.setString(12, "sha256:0");
            s.setString(13, "{\"dispatchMode\":\"background_v3_process\",\"sessionId\":\"" + runtime + "\",\"promptId\":\"turn-" + call + "\",\"callId\":\"tool-" + call + "\",\"argsDigest\":\"sha256:0\"}");
            s.setString(14, "PREPARED"); s.setString(15, null);
            s.setLong(16, 0); s.setBoolean(17, false); s.setLong(18, 0); s.setLong(19, 1);
            s.executeUpdate();
        }
    }

    public static void main(String[] args) throws Exception {
        MysqlDataSource ds = new MysqlDataSource();
        ds.setURL(args[1]);
        ds.setUser("root");
        ds.setPassword("r13986");
        try (Connection c = ds.getConnection()) {
            insertHold(c, "hs-alias-abc", "rs-lower", "call-lower");
            insertHold(c, "HS-ALIAS-ABC", "rs-upper", "call-upper");
            insertHold(c, "hs-alias-abc ", "rs-space", "call-space");
            try (PreparedStatement s = c.prepareStatement("SELECT COUNT(*) FROM ma_tool_execution WHERE harness_session_id = ?")) {
                s.setBytes(1, b("hs-alias-abc"));
                try (ResultSet r = s.executeQuery()) { r.next(); System.out.print("SQL '=' on the column matches " + r.getInt(1) + " row(s); "); }
            }
        }
        List<ToolExecutionRecord> rows = new JdbcToolExecutionRepository(ds)
                .findHoldRowsByHarnessSession("hs-alias-abc", null, 100);
        StringBuilder out = new StringBuilder("findHoldRowsByHarnessSession(\"hs-alias-abc\") -> " + rows.size() + " row(s):");
        for (ToolExecutionRecord row : rows) out.append(" [").append(row.getHarnessSessionId()).append("]/").append(row.getRuntimeSessionId());
        System.out.println(out);
    }
}
