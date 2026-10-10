// VERIFICATION RIG ONLY (PR #13682): rename/approval helpers on top of lib.mjs.
import { sql, one, api, sleep, tapEntries } from './lib.mjs';

// Public (SQL) title and the rename command rows of a Session.
export const dbTitle = (S) => one(`SELECT COALESCE(title,'<null>') FROM managed_agent_session WHERE session_id='${S}'`);
export const status = (S) => one(`SELECT status FROM managed_agent_session WHERE session_id='${S}'`);
export const renameCmds = (S) => sql(`SELECT idempotency_key, command_status FROM managed_agent_command WHERE session_id='${S}' AND operation='RENAME_SESSION' ORDER BY created_at`);
export const hasDeliveryTable = () => one(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='managed_session_rename_delivery'`) === '1';
export const delivery = (S) => (hasDeliveryTable() ? sql(`SELECT revision, idempotency_key, title, delivery_state, attempt_count, COALESCE(lease_owner,''), available_at FROM managed_session_rename_delivery WHERE session_id='${S}'`)[0] ?? null : 'n/a');

// Private (Harness journal) title records: each renameSession transaction's session_metadata recordRef, resolved to
// the resource bytes the Harness published to the Session Store.
export function journalTitles(S) {
  const rows = sql(`SELECT journal_revision, command_id, CAST(record_bytes AS CHAR CHARACTER SET utf8mb4) FROM qwen_managed_session_journal_tx WHERE session_id='${S}' AND operation LIKE '%renameSession%' ORDER BY journal_revision`);
  return rows.map(([rev, cmd, body]) => {
    const m = body.match(/"domain":"session_metadata"[^}]*?"recordRef":\{"resourceId":"([^"]+)"/);
    let title = null, managedRenameRevision = null, titleSource = null;
    if (m) {
      const hex = one(`SELECT HEX(inline_bytes) FROM qwen_managed_session_resource WHERE session_id='${S}' AND resource_id='${m[1]}'`);
      if (hex) {
        const doc = JSON.parse(Buffer.from(hex, 'hex').toString('utf8'));
        title = doc.title ?? null; managedRenameRevision = doc.managedRenameRevision ?? null; titleSource = doc.titleSource ?? null;
      }
    }
    return { rev: Number(rev), cmd, title, managedRenameRevision, titleSource };
  });
}
export const harnessTitle = (S) => journalTitles(S).at(-1)?.title ?? null;
export const titlePosts = (S) => tapEntries().filter((e) => e.method === 'POST' && e.path === `/session/${S}/title`).map((e) => ({ t: e.t, title: e.body?.title, rev: e.body?.managedRenameRevision ?? null, fault: e.fault ?? null, status: e.status ?? null }));

export async function until(fn, { timeoutMs = 60_000, every = 200 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return { ok: true, ms: Date.now() - t0, v };
    if (Date.now() - t0 > timeoutMs) return { ok: false, ms: Date.now() - t0 };
    await sleep(every);
  }
}
export const rename = (S, title, key, opts = {}) => api('PATCH', `/v1/agents/sessions/${S}`, { title }, { actor: 'alice', key, timeoutMs: 60_000, ...opts });
export const short = (r) => `${r.status} ${r.json?.error?.code ?? r.json?.code ?? r.json?.metadata?.title ?? r.json?.title ?? r.json?.status ?? ''}`.trim();
