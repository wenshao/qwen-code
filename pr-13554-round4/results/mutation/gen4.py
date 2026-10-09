import os, sys, json
ROOT = '/Users/wenshao/pr13554-rig/wt-h4/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/'
C = 'SessionResourceCollectionCollector.java'
R = 'WorkspaceRecoveryReader.java'
W = 'WorkspaceRecoveryStore.java'
G = 'WorkspaceMigrationStore.java'
M = [
 # round-1 set, re-applied to the round-3 head (M25 follows the renamed cadence fields)
 ('M01', C, "state = 'PUBLISHED' AND storage_kind", "storage_kind", 'eligibility: drop state=PUBLISHED'),
 ('M02', C, "AND storage_kind = 'MYSQL_INLINE'", "", 'eligibility: drop storage_kind=MYSQL_INLINE'),
 ('M03', C, "\" AND schema_version = 1 AND (\"", "\" AND (\"", 'eligibility: drop schema_version=1'),
 ('M04', C, '+ ManagedSessionStore.toolResultLimit("managed-tool-result-content") + ")"', '+ (ManagedSessionStore.toolResultLimit("managed-tool-result-content") + 1) + ")"', 'eligibility: content bound +1 byte'),
 ('M05', C, '" AND object_key IS NULL AND', '" AND', 'eligibility: drop object_key IS NULL'),
 ('M06', C, 'AND encryption_key_id IS NULL"', '"', 'eligibility: drop encryption_key_id IS NULL'),
 ('M07', C, 'AND r.resource_id = qwen_managed_session_resource.resource_id)', "AND r.resource_id = 'mutant-none')", 'eligibility: journal-ref exclusion disabled'),
 ('M08', C, '&& ToolPublicationRetentionStore.number(row, "gc_claim_until") > now) {', '&& ToolPublicationRetentionStore.number(row, "gc_claim_until") > now && false) {', 'claim: steal a live claim'),
 ('M09', C, 'next = now + PROTECTED_RECHECK_MILLIS;', 'next = now + CLAIM_MILLIS;', 'claim: recovery_protected backoff 60s instead of 24h'),
 ('M10', C, '> now - properties.getToolPublication().getDeletionGrace().toMillis()) {\n            return "grace_period";', '> now - properties.getToolPublication().getDeletionGrace().toMillis() && false) {\n            return "grace_period";', 'blocker: grace check off'),
 ('M12', C, '        if (leases > 0) {\n            return "reader_active";\n        }\n', '', 'blocker: read leases ignored'),
 ('M13', C, '|| ToolPublicationRetentionStore.number(row, "gc_generation") != claim.generation()', '', 'page: generation fence removed'),
 ('M14', C, '|| ToolPublicationRetentionStore.number(row, "gc_claim_until") <= now', '', 'page: claim-expiry fence removed'),
 ('M15', C, '|| !claim.cursor().equals(row.get("gc_cursor"))', '', 'page: cursor fence removed'),
 ('M16', C, 'bytes + length > PAGE_BYTES', 'bytes + length > Long.MAX_VALUE / 2', 'page: 32 MiB byte budget removed'),
 ('M17', C, 'gc_claim_until = 0, gc_next_at = -1, gc_blocker = NULL', 'gc_claim_until = 0, gc_next_at = 0, gc_blocker = NULL', 'complete: ledger stays in claim scan range'),
 ('M18', C, 'collected_bytes = collected_bytes + ?, collected_at = ?', 'collected_bytes = ?, collected_at = ?', 'complete: overwrite instead of add bytes'),
 ('M19', C, '"DELETE FROM qwen_output_read_lease WHERE tenant_key = ? AND session_key = ?"', '"DELETE FROM qwen_output_read_lease WHERE 1 = 0 AND tenant_key = ? AND session_key = ?"', 'complete: expired-lease sweep disabled'),
 ('M20', C, '+ " WHERE session_scope_key = ? AND gc_owner = ? AND gc_generation = ?"', '+ " WHERE session_scope_key = ? AND ? IS NOT NULL AND ? IS NOT NULL"', 'defer: owner/generation fence removed'),
 ('M21', C, 'r.retired_at <= ? ORDER BY r.retired_at LIMIT 32", due);', 'r.retired_at <= ? ORDER BY r.retired_at LIMIT 32", due + 86_400_000L);', 'ledger scan: grace filter off'),
 ('M22', C, 'ORDER BY r.retired_at LIMIT 32', 'ORDER BY r.retired_at LIMIT 1000', 'ledger scan: 32 cap removed'),
 ('M23', R, 'check(!"COLLECTED".equals(row.get("state")), "resource_collected");', 'check(true, "resource_collected");', 'recovery: resource_collected check removed'),
 ('M24', C, 'if (!properties.getToolPublication().isGcEnabled()) {', 'if (false) {', 'tick: gc-enabled gate removed'),
 ('M25', C, 'if (scanNow - lastLedgerScanNanos >= LEDGER_SCAN_NANOS) {', 'if (true) {', 'ledger scan: 60s cadence removed'),
 ('M26', C, '" AND gc_next_at >= 0 AND gc_next_at <= ?', '" AND gc_next_at <= ?', 'claim scan: completed (-1) ledgers rescanned'),
 ('M27', C, 'if (row.get("collected_at") != null || ToolPublicationRetentionStore.number(row, "gc_next_at") > now) {', 'if (row.get("collected_at") != null) {', 'claim: not-yet-due ledger claimable under lock'),
 ('M28', C, 'next = Math.addExact(retiredAt,\n                                properties.getToolPublication().getDeletionGrace().toMillis());', 'next = now + CLAIM_MILLIS;', 'claim: grace backoff 60s instead of retired_at+grace'),
 ('M29', C, 'ORDER BY gc_next_at, session_scope_key LIMIT 32', 'ORDER BY gc_next_at, session_scope_key LIMIT 1', 'claim scan: one candidate per tick'),
 ('M30', C, 'ORDER BY r.retired_at LIMIT 32', 'ORDER BY r.retired_at DESC LIMIT 32', 'ledger scan: newest first'),
 # round-3 changes
 ('N01', C, 'WHERE session_scope_key = ? AND inline_bytes IS NOT NULL AND resource_id IN (', 'WHERE session_scope_key = ? AND resource_id IN (', 'F1 fix: byte-drop UPDATE without the phantom guard'),
 ('N01b', C, "WHERE session_scope_key = ? AND state = 'COLLECTED' AND resource_id IN (", 'WHERE session_scope_key = ? AND resource_id IN (', 'F1 fix: freed-bytes sum without the state filter'),
 ('N02', C, '" ORDER BY resource_id LIMIT " + (PAGE_ROWS + 1);', '" ORDER BY resource_id LIMIT " + PAGE_ROWS;', 'R1-1: fetch 100 instead of 101 (lookahead lost)'),
 ('N03', C, '                more = true;\n                break;', '                break;', 'R1-1: byte-budget break no longer marks another page'),
 ('N04', C, 'boolean more = rows.size() > PAGE_ROWS;', 'boolean more = rows.size() >= PAGE_ROWS;', 'R1-1: exactly-100 page reports another page'),
 ('N05', C, 'rows.subList(0, Math.min(rows.size(), PAGE_ROWS))', 'rows', 'R1-1: page consumes the lookahead row (101 rows/page)'),
 ('N06', R, '+ " WHERE scope_key = ? AND resource_id = ? AND state = \'COLLECTED\'",', '+ " WHERE scope_key = ? AND resource_id = ?",', 'R2-6/R4-1: probe accepts any catalog state'),
 ('N07', R, 'Long.class, scope(head), text(ref, "resourceId"));\n                    check(collected', 'Long.class, text(head, "sessionId"), text(ref, "resourceId"));\n                    check(collected', 'R2-6: probe uses a wrong scope key'),
 ('N08', R, '+ " WHERE scope_key = ? AND resource_id = ? AND state = \'COLLECTED\'",\n                            Long.class, scope(head), text(ref, "resourceId"));', '+ " WHERE scope_key = ? AND ? IS NOT NULL AND state = \'COLLECTED\'",\n                            Long.class, scope(head), text(ref, "resourceId"));', 'R2-6: probe ignores resource_id (any COLLECTED object in the Session)'),
 ('N09', R, 'check(collected != null && collected > 0, "resource_corrupt");', '', 'R2-6: unexplained byte loss named resource_collected'),
 ('N10', C, 'this(jdbc, manager, properties, System::nanoTime);', 'this(jdbc, manager, properties, () -> System.currentTimeMillis() * 1_000_000L);', 'R2-5: production constructor reads the wall clock'),
 ('N11', C, 'LEDGER_SCAN_NANOS = Duration.ofMinutes(1).toNanos();', 'LEDGER_SCAN_NANOS = Duration.ofSeconds(1).toNanos();', 'R2-5: 1 s ledger-scan cadence'),
 ('N12', C, 'if (!java.util.Objects.equals(row.get("gc_blocker"), blocker)) {', 'if (true) {', 'R1-2: blocker log on every evaluation'),
 ('N13', C, 'ToolPublicationRetentionStore.number(row, "collected_bytes") + freed);', 'freed);', 'R1-4: completion log reports last page only'),
 ('N14', R, '+ " WHERE scope_key = ? AND resource_id = ? AND state = \'COLLECTED\'",', '+ " WHERE ? IS NOT NULL AND resource_id = ? AND state = \'COLLECTED\'",', 'R2-6: probe ignores scope_key'),
 ('R01', C, 'return recoveryInFlight(session, false) ? "recovery_active" : null;', 'return null;', 'R8-1: recovery_active blocker removed'),
 ('R02', C, '        if (recoveryInFlight(claim.session(), true)) {\n            return false;\n        }\n', '', 'R8-1: page-time recovery re-check removed'),
 ('R03', C, 'if (recoveryInFlight(claim.session(), true)) {', 'if (recoveryInFlight(claim.session(), false)) {', 'R8-1: page re-check is a plain (snapshot) read'),
 ('R04', C, '        ToolPublicationRetentionStore.lockSession(jdbc, claim.tenant(), claim.session());\n        var row = jdbc.queryForMap("SELECT * FROM qwen_managed_session_resource_collection"\n                + " WHERE session_scope_key = ? FOR UPDATE", claim.scope());\n        long now = ToolPublicationRetentionStore.now(jdbc);\n        if (row.get("collected_at") != null || !owner.equals', '        var row = jdbc.queryForMap("SELECT * FROM qwen_managed_session_resource_collection"\n                + " WHERE session_scope_key = ? FOR UPDATE", claim.scope());\n        long now = ToolPublicationRetentionStore.now(jdbc);\n        if (row.get("collected_at") != null || !owner.equals', 'R8-1: page() takes no session lock'),
 ('R05', C, "o.state IN ('CAPTURING', 'VERIFYING') LIMIT 1", "o.state IN ('CAPTURING') LIMIT 1", 'R8-1: VERIFYING operations no longer pin'),
 ('R06', C, '+ " WHERE s.session_id = ? AND o.state', '+ " WHERE ? IS NOT NULL AND o.state', 'R8-1: recovery pin not scoped to the Session'),
 ('R07', W, 'if ("source_drift".equals(error.code) || "resource_collected".equals(error.code)) {', 'if ("source_drift".equals(error.code)) {', 'R8-1: resource_collected does not invalidate the capture'),
 ('R08', G, "? IN ('source_drift', 'resource_collected') THEN 'INVALIDATED'", "? IN ('source_drift') THEN 'INVALIDATED'", 'R8-1: resource_collected does not invalidate the migration'),
 ('R09', W, 'if (++attempts >= 3) {', 'if (++attempts >= 1) {', 'R8-1: registration does not retry a lock wait'),
 ('R10', C, 'if (head != null && !"DELETED".equals(head.get("state"))) {', 'if (false) {', 'R10-3: locked head no longer blocks a live writer'),
]
out = sys.argv[1]; os.makedirs(out, exist_ok=True); meta = []
for mid, f, old, new, desc in M:
    src = open(ROOT + f).read(); n = src.count(old)
    if n != 1:
        print('BAD', mid, 'occurrences', n); continue
    d = os.path.join(out, mid); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, f), 'w').write(src.replace(old, new))
    meta.append({'id': mid, 'file': f, 'desc': desc})
json.dump(meta, open(os.path.join(out, 'mutants.json'), 'w'), indent=1)
print(len(meta), 'mutants')
