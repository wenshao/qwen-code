// Summarize one or more run results into compact lines + a TSV row each.
import fs from 'node:fs';
const S =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f2664731-3690-4937-833c-9c220ef51e4c/scratchpad';
const names = process.argv.slice(2);
const rows = [];
for (const name of names) {
  const file = `${S}/runs/${name}/result.json`;
  if (!fs.existsSync(file)) { console.log(`${name}: (no result)`); continue; }
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (r.boot) {
    console.log(`\n## ${name} [${r.arm}] boot up=${r.boot.up} exit=${r.boot.exit} msg=${(r.boot.message ?? '').slice(0, 160)}`);
    rows.push([name, r.arm, 'boot', r.boot.up ? 'UP' : 'REFUSED', (r.boot.message ?? '').slice(0, 120)].join('\t'));
    continue;
  }
  const ev = r.events ?? [];
  const turns = [...new Set(ev.map((e) => e.turn).filter(Boolean))];
  const perTurn = turns.map((t, i) => {
    const es = ev.filter((e) => e.turn === t);
    const term = es.filter((e) => e.terminal);
    return {
      turn: `T${i + 1}`,
      accepted: es.find((e) => e.type === 'turn.accepted')?.t,
      firstDelta: es.find((e) => e.type === 'item.output_text.delta')?.t,
      terminals: term.map((e) => `${e.type}@${e.t}ms${e.data?.error_code ? '/' + e.data.error_code : ''}${e.data?.errorCode ? '/' + e.data.errorCode : ''}${e.data?.code ? '/' + e.data.code : ''}`),
      types: [...new Set(es.map((e) => e.type))].join(','),
    };
  });
  const statusChanges = [];
  let last = '';
  for (const s of r.rowSamples ?? []) {
    if (s.rows !== last) { statusChanges.push(`${s.t}ms: ${s.rows.replace(/turn_[0-9a-f]+\t/g, '').replace(/\n/g, ' | ')}`); last = s.rows; }
  }
  console.log(`\n## ${name} [${r.arm}] session=${r.sessionId} error=${r.error ? r.error.split('\n')[0] : 'none'}`);
  console.log(`prompt deadlineMs on wire: ${JSON.stringify(r.harnessPrompts?.map((p) => p.deadlineMs))}`);
  for (const t of perTurn) console.log(`${t.turn}: accepted@${t.accepted} delta@${t.firstDelta} terminal=${JSON.stringify(t.terminals)}\n    types=${t.types}`);
  console.log(`turn row changes: ${statusChanges.join('  ->  ')}`);
  console.log(`durable turns: ${r.durable?.turns?.replace(/\n/g, ' | ')}`);
  console.log(`durable terminal events: ${r.durable?.terminalEvents?.replace(/turn_[0-9a-f]+/g, 'turn').replace(/\n/g, ' | ')}`);
  console.log(`followups: ${JSON.stringify(r.followups?.map((f) => `${f.status}@${f.t}ms ${f.status !== 202 ? f.body.slice(0, 140) : ''}`))}`);
  if (r.cancel) console.log(`cancel: ${JSON.stringify(r.cancel)}`);
  console.log(`model requests: ${JSON.stringify(r.model?.map((m) => `${m.mode} arr@${m.arrivedAt} close@${m.closedAt ?? 'open'} completed=${m.completed} roles=${m.roles}`))}`);
  if (r.actionSnapshots) console.log(`action snapshots: ${JSON.stringify(r.actionSnapshots.map((a) => ({ t: a.t, s: a.json?.data?.map((x) => x.state ?? x.status) })))}`);
  if (r.responds) console.log(`responds: ${JSON.stringify(r.responds.map((x) => ({ t: x.t, status: x.status, body: x.body.slice(0, 200), before: x.actionBefore?.state ?? x.actionBefore?.status })))}`);
  if (r.actions) console.log(`final actions: ${JSON.stringify(r.actions?.data?.map((a) => ({ id: a.id?.slice(0, 24), state: a.state ?? a.status, kind: a.kind })))}`);
  if (r.brokerTap?.length) console.log(`broker: ${JSON.stringify(r.brokerTap.map((o) => `${o.t} ${o.method} ${o.url.replace(/[0-9a-f-]{20,}/g, '…')} ${o.held ? 'HELD' : o.status}`))}`);
  console.log(`harness log: ${JSON.stringify(r.harnessLogLines?.slice(0, 8))}`);
  console.log(`durable deadline mentions: ${JSON.stringify(r.durable?.deadlineMentions?.map((d) => d.table + ': ' + d.hits.join(' || ').slice(0, 200)))}`);
  const T1 = perTurn[0];
  rows.push([name, r.arm, T1?.terminals?.join(' ') || 'NONE', statusChanges.at(-1) ?? '', JSON.stringify(r.followups?.map((f) => f.status)), perTurn.length > 1 ? perTurn[1].terminals.join(' ') : ''].join('\t'));
}
fs.appendFileSync(`${S}/rig/summary.tsv`, rows.join('\n') + '\n');
