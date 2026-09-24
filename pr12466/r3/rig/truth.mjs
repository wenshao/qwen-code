// Ground truth: every turn of every session in the head project dir, via GET /tool-calls,
// vs. the raw JSONL (functionCall ids between turn anchors + ui_telemetry tool_call timing).
import fs from 'node:fs';
const [port, dir, ws] = process.argv.slice(2);
const H = { authorization: 'Bearer tok12466' }; const W = encodeURIComponent(ws);
const get = async (p) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers: H }); return { status: r.status, body: await r.json().catch(() => null) }; };
const tot = { sessions: 0, turns: 0, calls: 0, orderEq: 0, missing: 0, extra: 0, timed: 0, timingEq: 0, timingMismatch: [], fabricated: 0, httpErr: [] };
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.includes('ledger'))) {
  const sid = f.replace('.jsonl', '');
  const recs = fs.readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const idx = await get(`/session/${sid}/turn-index?limit=200`);
  if (idx.status !== 200) { tot.httpErr.push(`${sid} index ${idx.status}`); continue; }
  tot.sessions++;
  const turnIds = idx.body.turns.map((t) => t.turnId);
  const pos = new Map(recs.map((r, i) => [r.uuid, i]));
  for (let k = 0; k < turnIds.length; k++) {
    const a = pos.get(turnIds[k]); const b = k + 1 < turnIds.length ? pos.get(turnIds[k + 1]) : recs.length;
    const slice = recs.slice(a, b);
    const expected = slice.filter((r) => r.type === 'assistant').flatMap((r) => (r.message?.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall.id));
    const tele = new Map(slice.filter((r) => r.systemPayload?.uiEvent?.['event.name'] === 'qwen-code.tool_call').map((r) => [r.systemPayload.uiEvent.call_id, r.systemPayload.uiEvent]));
    const res = await get(`/workspaces/${W}/session/${sid}/tool-calls?turnId=${turnIds[k]}`);
    tot.turns++;
    if (res.status !== 200) { tot.httpErr.push(`${sid}/${k} ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`); continue; }
    const got = []; const timing = new Map();
    for (const ev of res.body.events) {
      const u = ev.data; if (u.sessionUpdate === 'tool_call' && !got.includes(u.toolCallId)) got.push(u.toolCallId);
      const t = u._meta?.timing; if (t?.kind === 'tool') timing.set(t.callId, t);
    }
    tot.calls += expected.length;
    if (JSON.stringify(got) === JSON.stringify(expected)) tot.orderEq++;
    tot.missing += expected.filter((x) => !got.includes(x)).length; tot.extra += got.filter((x) => !expected.includes(x)).length;
    for (const [cid, t] of timing) {
      tot.timed++; const u = tele.get(cid);
      if (!u) { tot.timingMismatch.push(`${cid} no telemetry`); continue; }
      if (t.startedAt !== undefined && u.started_at_ms === undefined) tot.fabricated++;
      if (t.durationMs === u.duration_ms && (t.startedAt ?? null) === (u.started_at_ms ?? null)) tot.timingEq++;
      else tot.timingMismatch.push(`${sid.slice(0, 8)} ${cid} api=${t.startedAt}/${t.durationMs}/${t.toolStatus} jsonl=${u.started_at_ms}/${u.duration_ms}/${u.status}`);
    }
    for (const [cid, u] of tele) if (!timing.has(cid)) tot.timingMismatch.push(`${sid.slice(0, 8)} ${cid} jsonl-only ${u.started_at_ms}/${u.duration_ms}/${u.status}`);
  }
}
console.log(JSON.stringify(tot, null, 1));
