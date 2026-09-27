// Emits SQL that appends randomized pre-V14 events to existing Sessions (the
// V13 schema: no identity columns). Seeded, so a run is reproducible.
//   node legacy-gen.mjs <tenant> <seed> <sessionId...>  > legacy.sql
const [tenant, seedArg, ...sessions] = process.argv.slice(2);
let seed = Number(seedArg) >>> 0;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const lines = [];
const stats = { sessions: 0, events: 0, deltas: 0, empty: 0, reasoning: 0, tools: 0, gaps: 0, customItem: 0 };
for (const session of sessions) {
  stats.sessions++;
  let seq = 1; // session.created is 1
  const turns = stats.sessions === 1 && process.env.LONG ? Number(process.env.LONG) : 1 + Math.floor(rnd() * 4);
  for (let t = 0; t < turns; t++) {
    const turn = `turn_legacy_${session.slice(0, 8)}_${t}`;
    const add = (type, data, terminal = false) => {
      if (rnd() < Number(process.env.GAP ?? 0)) {
        seq++; // a hole in the sequence
        stats.gaps++;
      }
      seq++;
      stats.events++;
      lines.push(
        `INSERT INTO managed_agent_event (tenant_id, session_id, sequence_id, event_id, turn_id, event_type, data_json, terminal, source_key, created_at) VALUES (${q(tenant)}, ${q(session)}, ${seq}, ${q(`evt_legacy_${session.slice(0, 8)}_${seq}`)}, ${q(turn)}, ${q(type)}, ${q(JSON.stringify(data))}, ${terminal ? 1 : 0}, NULL, ${1790000000000 + seq});`,
      );
    };
    const inputItem = rnd() < 0.3 ? { itemId: `item_${turn}_input` } : {};
    add('turn.accepted', { ...inputItem, turnId: turn, input: [{ type: 'text', text: `legacy input ${t}` }, ...(rnd() < 0.3 ? [{ type: 'text', text: 'second block' }] : [])] });
    add('turn.started', { turnId: turn });
    const steps = 1 + Math.floor(rnd() * 14);
    let tool = 0;
    for (let i = 0; i < steps; i++) {
      const r = rnd();
      if (r < 0.45 || r >= 0.9) {
        const reasoning = r >= 0.9 || rnd() < 0.25;
        const type = reasoning ? 'item.reasoning.delta' : 'item.output_text.delta';
        const empty = rnd() < 0.1;
        const data = { text: empty ? '' : `${reasoning ? 'R' : 'T'}${seq + 1}.` };
        const itemRoll = rnd();
        if (itemRoll < 0.45) data.itemId = `item_${turn}_assistant`;
        else if (itemRoll < 0.55) {
          data.itemId = `item_custom_${turn}_${Math.floor(rnd() * 2)}`;
          stats.customItem++;
        }
        if (rnd() < 0.5) data.contentPartId = `part_${turn}_${reasoning ? 'reasoning' : 'output_text'}`;
        stats.deltas++;
        if (empty) stats.empty++;
        if (reasoning) stats.reasoning++;
        add(type, data);
      } else {
        stats.tools++;
        const kind = pick(['toolCallId', 'callId', 'itemId', 'none']);
        const id = `call_${tool % 2}`;
        if (rnd() < 0.5) tool++;
        const data = { kind: 'tool_call_update', status: pick(['in_progress', 'completed', 'failed', 'pending']) };
        if (kind === 'toolCallId') data.toolCallId = id;
        if (kind === 'callId') data.callId = id;
        if (kind === 'itemId') data.itemId = `item_tool_explicit_${turn}_${tool % 2}`;
        add('item.tool_call.updated', data);
      }
    }
    add(pick(['turn.completed', 'turn.completed', 'turn.failed', 'turn.cancelled']), {}, true);
  }
  lines.push(`UPDATE managed_agent_session SET last_sequence = ${seq} WHERE tenant_id = ${q(tenant)} AND session_id = ${q(session)};`);
}
console.log(lines.join('\n'));
console.error(JSON.stringify(stats));
