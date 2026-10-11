package com.alibaba.qwen.code.managedagent.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Verification-only (not part of the PR): after the real O4-2 collection that PublicationRecoveryProbeSupport
 * drives, print the collected rows' shape and ask the production WorkspaceRecoveryReader for every catalogued
 * publication object through publicationObject(), the method the R11-1 remap changed.
 */
public final class PublicationObjectProbeSupport {
    private PublicationObjectProbeSupport() {}

    public static List<String> read(DataSource source, String tenant, String workspace, String session) {
        var out = new ArrayList<String>();
        var jdbc = new JdbcTemplate(source);
        var head = jdbc.queryForMap("SELECT journal_revision, committed_sequence FROM qwen_managed_session_journal_head"
                + " WHERE tenant_id = ? AND session_id = ?", tenant, session);
        for (var row : jdbc.queryForList("SELECT publication_id, producer_phase, quarantined, retention_state, state"
                + " FROM qwen_tool_publication WHERE tenant_id = ? AND session_id = ?", tenant, session)) {
            out.add("shape publication " + row);
        }
        var reader = new WorkspaceRecoveryReader(jdbc, null);
        var json = new ObjectMapper();
        for (var row : jdbc.queryForList("SELECT o.publication_id, o.slot_key, o.state, o.inline_bytes IS NULL AS freed,"
                + " o.object_key IS NOT NULL AS has_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p"
                + " ON p.scope_key = o.scope_key AND p.publication_id = o.publication_id WHERE p.tenant_id = ?"
                + " AND p.session_id = ? ORDER BY o.slot_key", tenant, session)) {
            var src = json.createObjectNode();
            src.putObject("head").put("tenantId", tenant).put("workspaceId", workspace).put("sessionId", session)
                    .put("journalRevision", ((Number) head.get("journal_revision")).longValue())
                    .put("committedSequence", ((Number) head.get("committed_sequence")).longValue());
            String verdict;
            try {
                reader.publicationObject(src, (String) row.get("publication_id"), (String) row.get("slot_key"));
                verdict = "OK";
            } catch (RuntimeException error) {
                verdict = "REFUSED " + error.getMessage();
            }
            out.add("publication-object-read slot=" + row.get("slot_key") + " state=" + row.get("state") + " freed="
                    + row.get("freed") + " hasKey=" + row.get("has_key") + " -> " + verdict);
        }
        return out;
    }
}
