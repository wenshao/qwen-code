package com.alibaba.qwen.code.managedagent.store;

import com.alibaba.qwen.code.managedagent.config.ManagedAgentProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Verification-only (not part of the PR): after a real committed foreground capture, retire the Session
 * with the production transaction, run the production O4-2 ToolPublicationCollector until the publication
 * is COLLECTED, then ask the production WorkspaceRecoveryReader for every inline session-resource copy.
 */
public final class PublicationRecoveryProbeSupport {
    private PublicationRecoveryProbeSupport() {}

    public static List<String> run(DataSource source, String tenant, String workspace, String session) {
        var out = new ArrayList<String>();
        var jdbc = new JdbcTemplate(source);
        var manager = new DataSourceTransactionManager(source);
        var tx = new TransactionTemplate(manager);
        dump(jdbc, out, "before retirement");
        // Fixture artifacts, not production state: the borrowed test ends by deliberately corrupting and
        // quarantining segment:stdout:0, and its own reads leave unexpired read leases. Undo exactly those.
        int unquarantined = jdbc.update("UPDATE qwen_tool_publication_object SET state = 'VERIFIED' WHERE state = 'QUARANTINED'")
                + jdbc.update("UPDATE qwen_tool_publication SET quarantined = FALSE WHERE quarantined = TRUE");
        int leases = jdbc.update("UPDATE qwen_output_read_lease SET expires_at = 0");
        out.add("fixture reset: quarantined->VERIFIED rows=" + unquarantined + ", read leases expired=" + leases);
        // A crashed/finished writer: the lease has lapsed, as after a real Session close.
        jdbc.update("UPDATE qwen_managed_session_journal_head SET writer_lease_until = CURRENT_TIMESTAMP(6) - INTERVAL 1 SECOND"
                + " WHERE tenant_id = ? AND session_id = ?", tenant, session);
        tx.executeWithoutResult(status -> {
            ToolPublicationRetentionStore.lockDeletion(jdbc, tenant, session);
            ToolPublicationRetentionStore.retire(jdbc, tenant, session, "probe-delete");
        });
        var properties = new ManagedAgentProperties();
        properties.getToolPublication().setGcEnabled(true);
        properties.getToolPublication().setDeletionGrace(Duration.ZERO);
        var deleted = new ArrayList<String>();
        ToolPublicationObjectStore objects = new ToolPublicationObjectStore() {
            @Override public void putIfAbsent(String key, byte[] bytes) { throw new AssertionError("put " + key); }
            @Override public InputStream open(String key) { throw new AssertionError("open " + key); }
            @Override public void deleteIfPresent(String key) { deleted.add(key); }
            @Override public void requireUnversioned() { }
        };
        var collector = new ToolPublicationCollector(jdbc, manager, new ToolPublicationRetentionStore(jdbc, manager),
                objects, properties);
        int ticks = 0;
        while (ticks < 40 && !"COLLECTED".equals(jdbc.queryForObject("SELECT retention_state FROM qwen_tool_publication"
                + " WHERE tenant_id = ? AND session_id = ?", String.class, tenant, session))) {
            collector.runOnce();
            ticks++;
        }
        out.add("O4-2 collector ticks=" + ticks + " deleted-object-keys=" + deleted.size());
        dump(jdbc, out, "after O4-2 collection");
        var head = jdbc.queryForMap("SELECT journal_revision FROM qwen_managed_session_journal_head"
                + " WHERE tenant_id = ? AND session_id = ?", tenant, session);
        var reader = new WorkspaceRecoveryReader(jdbc, objects);
        var json = new ObjectMapper();
        for (var row : jdbc.queryForList("SELECT resource_id, kind, schema_version, byte_length, sha256, state,"
                + " storage_kind, inline_bytes IS NULL AS freed FROM qwen_managed_session_resource WHERE tenant_id = ?"
                + " AND session_id = ? ORDER BY kind, resource_id", tenant, session)) {
            var src = json.createObjectNode();
            src.putObject("head").put("tenantId", tenant).put("workspaceId", workspace).put("sessionId", session)
                    .put("journalRevision", ((Number) head.get("journal_revision")).longValue())
                    .putNull("latest_checkpoint_resource_id");
            var ref = json.createObjectNode().put("resourceId", (String) row.get("resource_id"))
                    .put("kind", (String) row.get("kind")).put("schemaVersion", ((Number) row.get("schema_version")).intValue())
                    .put("byteLength", ((Number) row.get("byte_length")).longValue()).put("digest", (String) row.get("sha256"));
            String verdict;
            try {
                var value = reader.resource(src, ref);
                verdict = "OK bytes=" + java.util.Base64.getDecoder().decode(value.path("bytesBase64").asText()).length;
            } catch (RuntimeException error) {
                verdict = "REFUSED " + error.getMessage();
            }
            out.add("recovery-read kind=" + row.get("kind") + " state=" + row.get("state") + " storage="
                    + row.get("storage_kind") + " freed=" + flag(row.get("freed")) + " -> " + verdict);
        }
        return out;
    }

    /** Same Session, negative control: the catalog marker no longer says COLLECTED. */
    public static List<String> demoteMarkerAndRead(DataSource source, String tenant, String workspace, String session,
            String newState) {
        var jdbc = new JdbcTemplate(source);
        int n = jdbc.update("UPDATE qwen_tool_publication_object SET state = ? WHERE scope_key = ?", newState,
                ToolPublicationDataStore.scope(tenant, workspace, session));
        var out = new ArrayList<String>();
        out.add("negative control: " + n + " catalog rows set to state=" + newState);
        var head = jdbc.queryForMap("SELECT journal_revision FROM qwen_managed_session_journal_head"
                + " WHERE tenant_id = ? AND session_id = ?", tenant, session);
        var reader = new WorkspaceRecoveryReader(jdbc, null);
        var json = new ObjectMapper();
        for (var row : jdbc.queryForList("SELECT resource_id, kind, schema_version, byte_length, sha256, state"
                + " FROM qwen_managed_session_resource WHERE tenant_id = ? AND session_id = ? AND inline_bytes IS NULL"
                + " ORDER BY kind", tenant, session)) {
            var src = json.createObjectNode();
            src.putObject("head").put("tenantId", tenant).put("workspaceId", workspace).put("sessionId", session)
                    .put("journalRevision", ((Number) head.get("journal_revision")).longValue());
            var ref = json.createObjectNode().put("resourceId", (String) row.get("resource_id"))
                    .put("kind", (String) row.get("kind")).put("schemaVersion", ((Number) row.get("schema_version")).intValue())
                    .put("byteLength", ((Number) row.get("byte_length")).longValue()).put("digest", (String) row.get("sha256"));
            String verdict;
            try {
                reader.resource(src, ref);
                verdict = "OK";
            } catch (RuntimeException error) {
                verdict = "REFUSED " + error.getMessage();
            }
            out.add("recovery-read kind=" + row.get("kind") + " -> " + verdict);
        }
        return out;
    }

    private static String flag(Object value) {
        return value instanceof Boolean b ? b.toString() : String.valueOf(((Number) value).intValue() != 0);
    }

    private static void dump(JdbcTemplate jdbc, List<String> out, String label) {
        out.add("-- " + label);
        for (var row : jdbc.queryForList("SELECT kind, storage_kind, state, byte_length, inline_bytes IS NULL AS freed,"
                + " object_key IS NOT NULL AS has_key FROM qwen_managed_session_resource ORDER BY kind")) {
            out.add("  session_resource " + row);
        }
        for (var row : jdbc.queryForList("SELECT slot_key, resource_kind, state, byte_length, inline_bytes IS NULL AS freed,"
                + " object_key IS NOT NULL AS has_key FROM qwen_tool_publication_object ORDER BY slot_key")) {
            out.add("  publication_object " + row);
        }
        for (var row : jdbc.queryForList("SELECT publication_id, state, retention_state, gc_blocker, gc_next_at, collected_bytes, (SELECT COUNT(*) FROM qwen_output_read_lease) AS read_leases FROM qwen_tool_publication")) {
            out.add("  publication " + row);
        }
    }
}
