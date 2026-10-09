package com.alibaba.qwen.code.runtimebroker;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Seeds realistic terminal Runtime Broker history into the database a real managed-server jar uses. */
public final class Seeder {
    static String url, user, pass;
    static DataSource source;
    static JdbcRuntimeBindingRepository bindings;
    static JdbcRuntimeSessionRepository sessions;
    static JdbcToolExecutionRepository executions;
    static String nextId;
    // Family -> expectation printed by "snapshot"
    static final Map<String, String> FAMILIES = new LinkedHashMap<>();

    public static void main(String[] args) throws Exception {
        url = args[1]; user = args[2]; pass = args[3];
        source = new DriverManagerDataSource(url, user, pass);
        var protector = AesGcmSecretProtector.fromBase64("k1", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
        bindings = new JdbcRuntimeBindingRepository(source, protector, () -> nextId);
        sessions = new JdbcRuntimeSessionRepository(source);
        executions = new JdbcToolExecutionRepository(source);
        switch (args[0]) {
            case "seed" -> seed();
            case "snapshot" -> snapshot();
            case "regen" -> regen(args[4]);
            case "hold" -> hold(args[4], Integer.parseInt(args[5]));
            case "tsprobe" -> tsprobe();
            case "settle" -> settle(args[4]);
            default -> throw new IllegalArgumentException(args[0]);
        }
    }

    /** Round-trip a microsecond Instant through the Broker's own setInstant/getInstant helpers. */
    static void tsprobe() throws Exception {
        try (Connection c = source.getConnection(); var st = c.createStatement()) {
            System.out.println("server " + c.getMetaData().getDatabaseProductVersion() + " driver "
                    + c.getMetaData().getDriverVersion());
            st.execute("CREATE TEMPORARY TABLE ts_probe (v DATETIME(6))");
            Instant written = Instant.parse("2026-08-29T06:02:04.216550Z");
            try (PreparedStatement p = c.prepareStatement("INSERT INTO ts_probe VALUES (?)")) {
                JdbcRepositorySupport.setInstant(p, 1, written);
                p.executeUpdate();
            }
            st.execute("INSERT INTO ts_probe VALUES ('2026-08-29 06:02:04.216550')");
            try (var rs = st.executeQuery("SELECT CAST(v AS CHAR) s, v FROM ts_probe")) {
                int row = 0;
                while (rs.next()) {
                    Instant read = JdbcRepositorySupport.getInstant(rs, "v");
                    System.out.println((row++ == 0 ? "app write via setInstant  " : "server-side literal write ")
                            + "stored=" + rs.getString("s") + " getInstant=" + read);
                    try (PreparedStatement q = c.prepareStatement("SELECT COUNT(*) FROM ts_probe WHERE v > ?")) {
                        JdbcRepositorySupport.setInstant(q, 1, read);
                        try (var r = q.executeQuery()) {
                            r.next();
                            System.out.println("    rows with v > (bound getInstant value) = " + r.getInt(1));
                        }
                    }
                }
            }
        }
    }

    static void hold(String tenant, int seconds) throws Exception {
        try (Connection c = source.getConnection()) {
            c.setAutoCommit(false);
            JdbcRuntimeBindingRepository.lockPlacementDomain(c, tenant);
            System.out.println("HOLDING placement domain " + tenant + " at " + Instant.now());
            Thread.sleep(seconds * 1000L);
            c.commit();
            System.out.println("RELEASED placement domain " + tenant + " at " + Instant.now());
        }
    }

    static RuntimeScope scope(String id) {
        return new RuntimeScope("tenant-" + id, "ws-" + id, "1", "/workspace/" + id,
                "sha256:" + "a".repeat(64), "session");
    }

    static RuntimeProvisionRequest request(String id, String kind, boolean managed) {
        return new RuntimeProvisionRequest(scope(id), "harness-" + id, kind, managed ? "storage-" + id : null);
    }

    /** Create through the real repository, then move it to a terminal state the way the PR's own fixtures do. */
    static RuntimeBindingRecord binding(String id, String kind, boolean managed, String state, String age) throws Exception {
        RuntimeProvisionRequest request = request(id, kind, managed);
        nextId = id;
        RuntimeBindingRecord created = bindings.findOrCreate(request);
        nextId = id + "-next";
        sql("UPDATE qwen_runtime_binding SET binding_state = ?, last_active_at = " + age + " WHERE binding_id = ?",
                state, created.getBindingId());
        sql("UPDATE qwen_runtime_binding_slot SET active_binding_id = NULL WHERE request_key = ?",
                JdbcRepositorySupport.requestKey(request));
        return bindings.findById(id);
    }

    static void session(RuntimeBindingRecord b, String id, String state, String age) throws Exception {
        RuntimeSessionRecord created = sessions.findOrCreate(new RuntimeSessionRecord(
                new RuntimeSession(b.getRequest().getIsolationKey(), id, "bootstrap", b.getRequest().getScope()),
                b.getBindingId(), b.getGeneration(), RuntimeSessionRecord.State.ACQUIRING, 0, Instant.now()));
        sessions.compareAndSet(created, created.withState(RuntimeSessionRecord.State.valueOf(state), Instant.now()));
        sql("UPDATE qwen_runtime_session SET last_active_at = " + age + " WHERE runtime_session_id = ?", id);
    }

    static void execution(RuntimeBindingRecord b, String session, String id, String state, String age) throws Exception {
        String harness = b.getRequest().getIsolationKey();
        executions.findOrCreate(ToolExecutionRecord.prepared(id, id + "-key", b.getBindingId(), b.getGeneration(),
                harness, session, "turn", "call-" + id, "digest",
                Map.of("sessionId", session, "promptId", "turn", "callId", "call-" + id, "argsDigest", "digest")));
        sql("UPDATE qwen_tool_execution SET execution_state = ?, cancel_requested = FALSE, execution_status = ?, "
                + "result_json = ?, settled_at = " + ("SETTLED".equals(state) ? age : "NULL")
                + ", abandoned_at = " + ("ABANDONED".equals(state) ? age : "NULL")
                + ", loss_evidence_id = ? WHERE execution_call_id = ?", state,
                "SETTLED".equals(state) ? "success" : null,
                "SETTLED".equals(state) ? "{\"executionStatus\":\"success\"}" : null,
                "ABANDONED".equals(state) ? "loss" : null, id);
    }

    static final String OLD = "(UTC_TIMESTAMP(6) - INTERVAL 40 DAY)";
    static final String NOW = "UTC_TIMESTAMP(6)";
    static final String FUTURE = "(UTC_TIMESTAMP(6) + INTERVAL 1 DAY)";

    static void seed() throws Exception {
        // ---- eligible families ----
        var legacy = binding("e-legacy", "legacy", false, "RELEASED", OLD);
        session(legacy, "e-legacy-s", "RELEASED", OLD);
        execution(legacy, "e-legacy-s", "e-legacy-x1", "SETTLED", OLD);
        execution(legacy, "e-legacy-x2-s".substring(0, 0) + "e-legacy-s", "e-legacy-x2", "ABANDONED", OLD);
        binding("e-static-failed", "static", false, "FAILED", OLD);
        var drained = binding("e-managed-drained", "local-process", true, "RELEASED", OLD);
        var handle = new RuntimeResourceHandle("local-process", 1, Map.of("worker", drained.getBindingId()));
        sql("UPDATE qwen_runtime_binding SET resource_handle_version = 1, resource_handle_json = ?, drain_requested = TRUE,"
                + " drain_receipt_json = ? WHERE binding_id = ?", handle.toJson(),
                new RuntimeDrainReceipt(drained.getBindingId(), drained.getGeneration(),
                        drained.getProvisionSeed().getProvisionRequestId(), handle, Instant.parse("2026-08-01T00:00:00Z")).toJson(),
                drained.getBindingId());
        var big = binding("e-big", "legacy", false, "RELEASED", OLD);
        for (int s = 0; s < 20; s++) {
            session(big, String.format("e-big-s%02d", s), "RELEASED", OLD);
        }
        for (int x = 0; x < 250; x++) {
            execution(big, String.format("e-big-s%02d", x % 20), String.format("e-big-x%03d", x), "SETTLED", OLD);
        }
        var lookup = binding("h-lookup", "legacy", false, "RELEASED", OLD);
        session(lookup, "h-session", "RELEASED", OLD);
        execution(lookup, "h-session", "h-exec", "SETTLED", OLD);

        // ---- protected families ----
        var operator = binding("p-operator", "legacy", false, "RELEASED", OLD);
        session(operator, "p-operator-s", "RELEASED", OLD);
        execution(operator, "p-operator-s", "p-operator-x", "SETTLED", OLD);
        sql("INSERT INTO managed_workspace_operator_recovery (recovery_id, binding_id, runtime_generation, storage_key,"
                + " holder_key, runtime_session_id, provision_request_id, resource_handle_json, runtime_lease_id, runtime_epoch,"
                + " blocked_execution_call_id, operator_id, reason, prepared_at, completed_at)"
                + " VALUES (?, ?, ?, ?, ?, 'p-operator-s', 'req', '{}', 'lease', 1, 'p-operator-x', 'op', 'completed recovery',"
                + OLD + ", " + OLD + ")", UUID.randomUUID().toString(), operator.getBindingId(), operator.getGeneration(),
                "a".repeat(64), "b".repeat(64));
        var pub = binding("p-publication", "legacy", false, "RELEASED", OLD);
        session(pub, "p-publication-s", "RELEASED", OLD);
        execution(pub, "p-publication-s", "p-pub-referenced-雪", "SETTLED", OLD);
        execution(pub, "p-publication-s", "p-pub-sibling", "SETTLED", OLD);
        sql("INSERT INTO qwen_tool_publication (scope_key, tenant_key, tenant_id, workspace_id, session_id, publication_id,"
                + " execution_key, capture_id, binding_json, binding_digest, token_hash, state, retention_state, capture_bytes,"
                + " producer_bytes, admission_bytes) VALUES (?, ?, 'tenant-p-publication', 'ws', 'session', 'publication-1', ?,"
                + " 'capture', 'payload-is-not-parsed', ?, ?, 'FENCED', 'COLLECTED', 0, 0, 0)",
                "a".repeat(64), "b".repeat(64), sha256("p-pub-referenced-雪"), "c".repeat(64), "d".repeat(64));
        var ack = binding("p-ack", "legacy", false, "RELEASED", OLD);
        session(ack, "p-ack-s", "RELEASED", OLD);
        execution(ack, "p-ack-s", "p-ack-x", "SETTLED", OLD);
        sql("INSERT INTO managed_workspace_csi_worker_ack (retirement_id, execution_call_id_hash, execution_call_id,"
                + " evidence_json, evidence_digest, recorded_at_epoch_micros) VALUES (?, ?, 'p-ack-x', '{}', ?, 1)",
                UUID.randomUUID().toString(), sha256("p-ack-x"), "e".repeat(64));
        var holder = binding("p-holder", "legacy", false, "RELEASED", OLD);
        sql("INSERT INTO managed_workspace_execution_lease (storage_key, holder_key, binding_id, runtime_generation,"
                + " runtime_session_id) VALUES (?, ?, ?, ?, 'p-holder-s')", "f".repeat(64), "1".repeat(64),
                holder.getBindingId(), holder.getGeneration());
        var nonterminal = binding("p-nonterminal", "legacy", false, "RELEASED", OLD);
        session(nonterminal, "p-nonterminal-s", "READY", OLD);
        execution(nonterminal, "p-nonterminal-s", "p-nonterminal-x", "SETTLED", OLD);
        binding("p-managed-unproven", "local-process", true, "RELEASED", OLD);
        binding("p-recent", "legacy", false, "RELEASED", NOW);
        for (String state : new String[] {"READY", "LOST", "RECOVERY_BLOCKED", "OPERATOR_RECOVERY", "DRAINING"}) {
            binding("p-state-" + state.toLowerCase().replace('_', '-'), "legacy", false, state, OLD);
        }
        var lease = binding("p-dispatch-lease", "legacy", false, "RELEASED", OLD);
        session(lease, "p-dispatch-lease-s", "RELEASED", OLD);
        execution(lease, "p-dispatch-lease-s", "p-dispatch-lease-x", "SETTLED", OLD);
        sql("UPDATE qwen_tool_execution SET dispatch_owner = 'owner', dispatch_lease_until = " + FUTURE
                + ", dispatch_generation = 1 WHERE execution_call_id = 'p-dispatch-lease-x'");
        var seeded = binding("p-failed-seeded", "legacy", false, "FAILED", OLD);
        sql("UPDATE qwen_runtime_binding SET provision_request_id = 'present' WHERE binding_id = ?", seeded.getBindingId());
        var slot = binding("p-active-slot", "legacy", false, "RELEASED", OLD);
        sql("UPDATE qwen_runtime_binding_slot SET active_binding_id = ? WHERE request_key = ?", slot.getBindingId(),
                JdbcRepositorySupport.requestKey(slot.getRequest()));
        if (!"false".equals(System.getenv("SEED_CHILDREN"))) {
            seedChildren();
        }
        System.out.println("SEEDED");
        snapshot();
    }

    /** A stopped local-process binding with physical stop proof, the shape a drained child leaves behind. */
    static RuntimeBindingRecord drainedManaged(String id) throws Exception {
        var b = binding(id, "local-process", true, "RELEASED", OLD);
        var handle = new RuntimeResourceHandle("local-process", 1, Map.of("worker", b.getBindingId()));
        sql("UPDATE qwen_runtime_binding SET resource_handle_version = 1, resource_handle_json = ?, drain_requested = TRUE,"
                + " drain_receipt_json = ? WHERE binding_id = ?", handle.toJson(),
                new RuntimeDrainReceipt(b.getBindingId(), b.getGeneration(),
                        b.getProvisionSeed().getProvisionRequestId(), handle, Instant.parse("2026-08-01T00:00:00Z")).toJson(),
                b.getBindingId());
        return bindings.findById(id);
    }

    /** managed_agent_session row for the binding's isolation key (the child's managed Session ID). */
    static void managedSession(RuntimeBindingRecord b, String parent, String run) throws Exception {
        sql("INSERT INTO managed_agent_session (tenant_id, session_id, agent_id, status, created_at, updated_at,"
                + " parent_session_id, parent_child_run_id, root_session_id, child_depth)"
                + " VALUES (?, ?, 'qwen-code', 'CLOSED', 1, 1, ?, ?, ?, ?)", b.getRequest().getScope().getTenantId(),
                b.getRequest().getIsolationKey(), parent, run, parent, parent == null ? null : 1);
    }

    /** The parent's canonical child_run projection, keyed exactly as ManagedSessionStore/ManagedExtensionProjection do. */
    static void projection(RuntimeBindingRecord b, String parent, String run, String storedRecordId, boolean settled)
            throws Exception {
        String tenant = b.getRequest().getScope().getTenantId();
        sql("INSERT INTO qwen_managed_session_extension_record (session_scope_key, record_key, tenant_id, workspace_id,"
                + " session_id, domain, record_id, operation_hash, revision, record_resource_id, task_kind, task_state,"
                + " runtime_state, delivery_target, delivery_state, created_at, settled_at)"
                + " VALUES (?, ?, ?, ?, ?, 'child_run', ?, ?, 1, 'resource', 'child_agent', ?, 'unbound', 'session', ?, 1, ?)",
                sha256(tenant + "\u0000" + parent), sha256(parent + "\u0000child_run\u0000" + run), tenant,
                b.getRequest().getScope().getWorkspaceId(), parent, storedRecordId, "a".repeat(64),
                settled ? "cancelled" : "pending", settled ? "settled" : "planned", settled ? 2L : null);
    }

    static void seedChildren() throws Exception {
        // eligible: a root managed Session (no lineage) and a child whose canonical run is settled
        var root = drainedManaged("c-root");
        managedSession(root, null, null);
        var settled = drainedManaged("c-settled");
        session(settled, "c-settled-s", "RELEASED", OLD);
        execution(settled, "c-settled-s", "c-settled-x", "SETTLED", OLD);
        managedSession(settled, "parent-c", "run-c-settled");
        projection(settled, "parent-c", "run-c-settled", "run-c-settled", true);
        // protected: projection unsettled / missing / half lineage / different raw record_id
        var pending = drainedManaged("c-pending");
        session(pending, "c-pending-s", "RELEASED", OLD);
        managedSession(pending, "parent-c", "run-c-pending");
        projection(pending, "parent-c", "run-c-pending", "run-c-pending", false);
        var missing = drainedManaged("c-missing");
        managedSession(missing, "parent-c", "run-c-missing");
        var half = drainedManaged("c-half");
        managedSession(half, "parent-c", null);
        var rawid = drainedManaged("c-rawid");
        managedSession(rawid, "parent-c", "run-c-rawid");
        projection(rawid, "parent-c", "run-c-rawid", "RUN-C-RAWID", true);
    }

    static void settle(String id) throws Exception {
        sql("UPDATE qwen_managed_session_extension_record SET task_state = 'cancelled', delivery_state = 'settled',"
                + " settled_at = 2 WHERE domain = 'child_run' AND record_id = ?", "run-" + id);
        System.out.println("settled child_run run-" + id);
    }

    static void snapshot() throws Exception {
        try (Connection c = source.getConnection()) {
            for (String t : new String[] {"qwen_runtime_binding", "qwen_runtime_session", "qwen_tool_execution",
                    "qwen_runtime_binding_slot", "qwen_runtime_placement_guard"}) {
                try (var st = c.createStatement(); var rs = st.executeQuery("SELECT COUNT(*) FROM " + t)) {
                    rs.next();
                    System.out.printf("count %-30s %d%n", t, rs.getInt(1));
                }
            }
            try (var st = c.createStatement(); var rs = st.executeQuery(
                    "SELECT b.binding_id, b.binding_state, b.runtime_generation,"
                    + " (SELECT COUNT(*) FROM qwen_runtime_session s WHERE s.binding_id = b.binding_id) sessions,"
                    + " (SELECT COUNT(*) FROM qwen_tool_execution x WHERE x.binding_id = b.binding_id) executions"
                    + " FROM qwen_runtime_binding b ORDER BY b.binding_id")) {
                while (rs.next()) {
                    System.out.printf("binding %-28s %-18s gen=%d sessions=%d executions=%d%n", rs.getString(1),
                            rs.getString(2), rs.getLong(3), rs.getInt(4), rs.getInt(5));
                }
            }
            try (var st = c.createStatement(); var rs = st.executeQuery(
                    "SELECT execution_call_id FROM qwen_tool_execution WHERE binding_id IN ('p-publication','p-ack')"
                    + " ORDER BY execution_call_id")) {
                while (rs.next()) {
                    System.out.println("kept-execution " + rs.getString(1));
                }
            }
        }
    }

    static void regen(String id) throws Exception {
        nextId = id + "-gen2";
        RuntimeBindingRecord next = bindings.findOrCreate(request(id, "legacy", false));
        System.out.println("regen " + id + " -> binding=" + next.getBindingId() + " generation=" + next.getGeneration()
                + " state=" + next.getState());
    }

    static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    static void sql(String statement, Object... values) throws Exception {
        try (Connection c = source.getConnection(); PreparedStatement p = c.prepareStatement(statement)) {
            for (int i = 0; i < values.length; i++) {
                p.setObject(i + 1, values[i]);
            }
            p.executeUpdate();
        }
    }
}
