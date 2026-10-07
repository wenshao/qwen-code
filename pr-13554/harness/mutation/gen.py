import os, sys, shutil, json
ROOT = '/root/verify/pr13554/wt-pr/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/'
C = 'SessionResourceCollectionCollector.java'
R = 'WorkspaceRecoveryReader.java'
M = [
 ('M01', C, "state = 'PUBLISHED' AND storage_kind", "storage_kind", 'eligibility: drop state=PUBLISHED (REFERENCED rows collectable)'),
 ('M02', C, "AND storage_kind = 'MYSQL_INLINE'", "", 'eligibility: drop storage_kind=MYSQL_INLINE'),
 ('M03', C, "\" AND schema_version = 1 AND (\"", "\" AND (\"", 'eligibility: drop schema_version=1'),
 ('M04', C, '+ ManagedSessionStore.toolResultLimit("managed-tool-result-content") + ")"', '+ (ManagedSessionStore.toolResultLimit("managed-tool-result-content") + 1) + ")"', 'eligibility: content bound +1 byte'),
 ('M05', C, '" AND object_key IS NULL AND', '" AND', 'eligibility: drop object_key IS NULL'),
 ('M06', C, 'AND encryption_key_id IS NULL"', '"', 'eligibility: drop encryption_key_id IS NULL'),
 ('M07', C, 'AND r.resource_id = qwen_managed_session_resource.resource_id)', "AND r.resource_id = 'mutant-none')", 'eligibility: journal-ref exclusion disabled'),
 ('M08', C, '&& ToolPublicationRetentionStore.number(row, "gc_claim_until") > now) {', '&& ToolPublicationRetentionStore.number(row, "gc_claim_until") > now && false) {', 'claim: steal a live claim'),
 ('M09', C, 'next = now + PROTECTED_RECHECK_MILLIS;', 'next = now + CLAIM_MILLIS;', 'claim: recovery_protected backoff 60s instead of 24h'),
 ('M10', C, '> now - properties.getToolPublication().getDeletionGrace().toMillis()) {\n            return "grace_period";', '> now - properties.getToolPublication().getDeletionGrace().toMillis() && false) {\n            return "grace_period";', 'blocker: grace check off'),
 ('M11', C, 'if (!heads.isEmpty() && !"DELETED".equals(heads.getFirst().get("state"))) {', 'if (false) {', 'blocker: live head ignored'),
 ('M12', C, 'return leases == 0 ? null : "reader_active";', 'return null;', 'blocker: read leases ignored'),
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
 ('M25', C, 'if (scanNow - lastLedgerScanMillis >= LEDGER_SCAN_MILLIS) {', 'if (true) {', 'ledger scan: 60s cadence removed'),
 ('M26', C, '" AND gc_next_at >= 0 AND gc_next_at <= ?', '" AND gc_next_at <= ?', 'claim scan: completed (-1) ledgers rescanned'),
 ('M27', C, 'if (row.get("collected_at") != null || ToolPublicationRetentionStore.number(row, "gc_next_at") > now) {', 'if (row.get("collected_at") != null) {', 'claim: not-yet-due ledger claimable under lock'),
 ('M28', C, 'next = Math.addExact(retiredAt,\n                                properties.getToolPublication().getDeletionGrace().toMillis());', 'next = now + CLAIM_MILLIS;', 'claim: grace backoff 60s instead of retired_at+grace'),
 ('M29', C, 'ORDER BY gc_next_at, session_scope_key LIMIT 32', 'ORDER BY gc_next_at, session_scope_key LIMIT 1', 'claim scan: one candidate per tick'),
 ('M30', C, 'ORDER BY r.retired_at LIMIT 32', 'ORDER BY r.retired_at DESC LIMIT 32', 'ledger scan: newest first'),
]
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
meta = []
for mid, f, old, new, desc in M:
    src = open(ROOT + f).read()
    n = src.count(old)
    if n != 1:
        print('BAD', mid, 'occurrences', n); continue
    d = os.path.join(out, mid); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, f), 'w').write(src.replace(old, new))
    meta.append({'id': mid, 'file': f, 'desc': desc})
json.dump(meta, open(os.path.join(out, 'mutants.json'), 'w'), indent=1)
print(len(meta), 'mutants')
