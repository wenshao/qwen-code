// S22 (d4dd9afbe3 "merge main and preserve managed hook policy"):
// A. Text deltas (main #13083): Sessions whose catalog has Stop or MessageDisplay buffer model text until those
//    decisions complete; a draft discarded by a Stop block never becomes a durable message.delta. Others stream.
// B. Runtime-only takeover (main #13083): the load takeover flags keep Hook Sessions on Hook-aware reconciliation, and
//    managed-runtime/continue|cancel refuse Hook Sessions with hosted_hook_recovery_required before touching records.
import { createHash, randomUUID } from 'node:crypto';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, pin, hookLedger, hookRecords, setControl, sql, j, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
if (!process.env.DB) throw new Error('DB is required');
const arm = process.env.ARM ?? 'head';
const R = new Report(`s22-merge-policy-${arm}${process.env.ONLY ? `-${process.env.ONLY}` : ''}`);
const digest = (t) => createHash('sha256').update(t).digest('hex');
const deltas = (id) => sql(`SELECT content_digest FROM qwen_managed_session_journal_tx WHERE session_id='${id}' AND operation='assistantDelta' ORDER BY journal_revision`).map((r) => r[0]);
const head = (id) => sql(`SELECT committed_sequence, journal_revision, IFNULL(writer_id,'-') FROM qwen_managed_session_journal_head WHERE session_id='${id}'`)[0]?.join('/');
const lease = (ws) => sql(`SELECT IFNULL(runtime_session_id,'<free>') FROM managed_workspace_execution_lease WHERE storage_key=SHA2(CONCAT('t-rig', CHAR(0), 'st-${STORAGE[ws]}'),256)`)[0]?.[0] ?? '<no row>';
const textOf = (id) => sql(`SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${id}' AND kind='managed-message'`).map((r) => JSON.parse(r[0])).filter((o) => o.type === 'assistant').flatMap((o) => (o.message?.parts ?? []).map((p) => p.text).filter(Boolean)).join('|');
const chunks = async (s) => (await s.transcript().catch(() => [])).filter((e) => e.data?.update?.sessionUpdate === 'agent_message_chunk').map((e) => e.data.update.content?.text).join('|');
const model = await startModel();
const h = await new Harness({ name: `s22-${arm}`, modelUrl: model.url, arm }).start();
try {
  if (!process.env.ONLY || process.env.ONLY === 'A') {
    for (const [WS, label, control, expectDraftDelta] of [
      ['ws-dz0', 'no Hooks', {}, true],
      ['ws-dz1', 'UserPromptSubmit Hook only (no output policy)', {}, true],
      ['ws-dz2', 'Stop Hook blocks the first draft once', { stop: { blockOnce: true } }, false],
      ['ws-dz3', 'Stop Hook allows', {}, false],
      ['ws-dz4', 'MessageDisplay Hook', {}, false],
    ]) {
      setControl(control);
      const w = await workspace(STORAGE[WS], WS);
      const id = await createWorkspaceSession(w.workspaceId);
      const s = new HSession(h, id, storeConnection(h, w.workspaceId));
      await s.create(WS === 'ws-dz0' ? undefined : { hookCatalog: pin(WS) });
      const p = await s.prompt(script([], 'DRAFT-ONE'), 60_000);
      const d = deltas(id);
      const committed = textOf(id);
      const shown = await chunks(s);
      const draftDelta = d.includes(digest('DRAFT-ONE'));
      const finalDelta = d.includes(digest('FINAL-TWO'));
      const ok = p.terminal?.[0]?.type === 'turn_complete' && (expectDraftDelta ? draftDelta : !draftDelta) && (WS !== 'ws-dz2' || committed === 'FINAL-TWO');
      R.check(`A ${label}: ${expectDraftDelta ? 'model text streams as durable deltas' : 'no durable delta of a draft before the Hook decision'}`, ok,
        `turn=${turn(p)} durable assistant text=${j(committed)} client chunks=${j(shown)} message.delta commits=${d.length} delta==DRAFT-ONE:${draftDelta} delta==FINAL-TWO:${finalDelta}`);
      await s.detach();
    }
    setControl({});
  }
  if (!process.env.ONLY || process.env.ONLY === 'B') {
    // B0: the Runtime-only routes exist for a Session without Hooks (a malformed body is rejected as such).
    {
      const w = await workspace(STORAGE['ws-tk0'], 'ws-tk0');
      const id = await createWorkspaceSession(w.workspaceId);
      const s = new HSession(h, id, storeConnection(h, w.workspaceId));
      await s.create();
      const c = await h.json(`/session/${id}/managed-runtime/continue`, {}, { clientId: s.clientId });
      const x = await h.json(`/session/${id}/managed-runtime/cancel`, {}, { clientId: s.clientId });
      R.note('B0 no-Hook Session: Runtime-only continue / cancel with an empty body', `continue=${c.status} ${c.json?.code ?? ''} cancel=${x.status} ${x.json?.code ?? ''}`);
      await s.detach();
    }
    for (const [WS, flags, label] of [
      ['ws-tk1', { driveRuntimeRecovery: true }, 'load with driveRuntimeRecovery'],
      ['ws-tk2', { passiveManagedRuntimeRecovery: true }, 'load with passiveManagedRuntimeRecovery'],
      ['ws-tk3', {}, 'plain load (control)'],
    ]) {
      setControl({ cxPre: { sleepMs: 8000 } });
      const w = await workspace(STORAGE[WS], WS);
      const hk = await new Harness({ name: `s22k-${arm}-${WS}`, modelUrl: model.url, arm }).start();
      const id = await createWorkspaceSession(w.workspaceId);
      const s = new HSession(hk, id, storeConnection(hk, w.workspaceId));
      await s.create({ hookCatalog: pin(WS) });
      const l0 = hookLedger().length;
      const sub = await s.submit(script([[call('write_file', { file_path: `tk-${Date.now()}.txt`, content: 'x' })]], `TK-${WS}`));
      for (let i = 0; i < 200 && !hookLedger().slice(l0).some((e) => e.name === 'cxPre' && e.session === id && !e.kind); i++) await sleep(100);
      await hk.stop('SIGKILL');
      hk.attached?.clear?.();
      setControl({});
      const h2 = await new Harness({ name: `s22r-${arm}-${WS}`, modelUrl: model.url, arm }).start();
      try {
        const s2 = new HSession(h2, id, storeConnection(h2, w.workspaceId));
        const t0 = Date.now();
        let l;
        const codes = [];
        for (;;) {
          l = await s2.load(flags);
          codes.push(`${l.status}${l.json?.code ? ` ${l.json.code}` : ''}${l.json?.recoveryRequired ? ' recoveryRequired' : ''}`);
          if (l.status === 200 || Date.now() - t0 > 150_000) break;
          await sleep(10_000);
        }
        const before = head(id);
        const leaseBefore = lease(WS);
        const body = { promptId: sub.promptId ?? randomUUID(), checkpointId: 'cp-probe', activationId: 'act-probe' };
        const c = l.status === 200 ? await h2.json(`/session/${id}/managed-runtime/continue`, body, { clientId: s2.clientId }) : { status: '-' };
        const x = l.status === 200 ? await h2.json(`/session/${id}/managed-runtime/cancel`, body, { clientId: s2.clientId }) : { status: '-' };
        const after = head(id);
        const rec = hookRecords(id, 'hook_execution').filter((r) => r.rec.eventName === 'PreToolUse' && r.rec.ordinal > 0).at(-1)?.rec;
        const st = l.status === 200 ? await s2.status() : {};
        R.check(`B ${label}: Hook Session after a Harness SIGKILL mid-PreToolUse; Runtime-only routes refuse without touching records`, l.status === 200 && c.status === 409 && c.json?.code === 'hosted_hook_recovery_required' && x.status === 409 && x.json?.code === 'hosted_hook_recovery_required' && before === after && lease(WS) === leaseBefore,
          `load attempts=[${codes.join(', ')}] after ${Math.round((Date.now() - t0) / 1000)}s recoveryBlocked=${st.recoveryBlocked} hook=${rec?.run.state}/${j(rec?.run.execution)} | continue=${c.status} ${c.json?.code ?? ''} cancel=${x.status} ${x.json?.code ?? ''} journal head before/after=${before} → ${after} lease ${leaseBefore === lease(WS) ? 'unchanged' : 'CHANGED'}`);
        if (l.status === 200) await s2.detach();
      } finally {
        await h2.close();
      }
    }
  }
} finally {
  setControl({});
  await h.close();
  await model.close();
  R.done();
}
