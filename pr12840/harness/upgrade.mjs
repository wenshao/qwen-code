// V13 -> V15 upgrade differential on one database:
//  1. main's jar writes real Turns (hosted harness) and Sessions that then get
//     randomized legacy events by SQL; main's materializer builds the Items.
//  2. The PR jar migrates (V14 columns, V15 Java backfill).
//  3. Every backfilled identity is checked against main's Snapshot.
//  4. Rollback to main on the V15 schema, write, and roll forward again.
// Spring processes are stopped by PID only.
//   node upgrade.mjs <label> <jdbcBase> <dbPort> <out.json>
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const SP = '/path/to/scratchpad';
const [label, jdbcBase, dbPort, out] = process.argv.slice(2);
const DB = `p840_up_${label}`;
const PORT = 33853;
const HARNESS = 33854;
const U = `http://127.0.0.1:${PORT}`;
const tenant = `rig-up-${label}-${Date.now().toString(36)}`;
const results = { label, db: DB, tenant, steps: [], checks: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const sql = (q, d = DB) =>
  execFileSync(MYSQL, ['--no-defaults', '-uroot', '-prig12840', '-h127.0.0.1', `-P${dbPort}`, '-N', '-B', '--raw', ...(d ? [d] : []), '-e', q], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 })
    .toString()
    .trim();
const sqlFile = (file) => execFileSync('/bin/sh', ['-c', `${MYSQL} --no-defaults -uroot -prig12840 -h127.0.0.1 -P${dbPort} ${DB} < ${file}`], { stdio: ['ignore', 'pipe', 'pipe'] });
const rows = (q) => sql(q).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const record = (name, pass, detail) => {
  results.checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
};
const step = (s) => {
  results.steps.push(s);
  console.log(`== ${s}`);
};

let proc;
async function start(jar, name) {
  const log = `${SP}/logs/upgrade-${label}-${name}.log`;
  proc = spawn(`${SP}/rig/spring.sh`, [`${SP}/jars/${jar}`, String(PORT), String(HARNESS), jdbcBase, DB], { stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')] });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${U}/actuator/health`);
      if (r.status === 200) {
        const text = fs.readFileSync(log, 'utf8');
        const flyway = text.split('\n').filter((l) => /Migrating schema|Successfully applied|Schema .* is up to date|future|newer/.test(l)).map((l) => l.replace(/.*: /, ''));
        console.log(`   [${name}] up pid ${proc.pid}; ${flyway.join(' | ')}`);
        return { log, flyway };
      }
    } catch {}
    if (proc.exitCode !== null) {
      const text = fs.readFileSync(log, 'utf8');
      throw new Error(`[${name}] exited: ${text.split('\n').filter((l) => /Caused by|FAILED|Exception/.test(l)).slice(0, 4).join(' / ')}`);
    }
    await sleep(1000);
  }
  throw new Error(`[${name}] timeout`);
}
async function stop() {
  if (!proc) return;
  const pid = proc.pid;
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 40 && proc.exitCode === null; i++) await sleep(250);
  if (proc.exitCode === null) process.kill(pid, 'SIGKILL');
  proc = undefined;
}
async function api(method, path, body) {
  const init = { method, headers: { 'X-Qwen-Tenant-Id': tenant, accept: 'application/json', 'Idempotency-Key': randomUUID() } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(U + path, init);
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function settledAll(timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lag = Number(
      sql(`SELECT COUNT(*) FROM managed_agent_session s JOIN managed_agent_consumer_progress p ON p.tenant_id = s.tenant_id AND p.session_id = s.session_id WHERE s.tenant_id = '${tenant}' AND p.covered_sequence < s.last_sequence`),
    );
    const active = Number(sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE tenant_id = '${tenant}' AND status IN ('ACCEPTED','RUNNING','CANCELLING')`));
    if (lag === 0 && active === 0) return Date.now() - t0;
    await sleep(300);
  }
  throw new Error('materializer did not settle');
}

try {
  execFileSync(MYSQL, ['--no-defaults', '-uroot', '-prig12840', '-h127.0.0.1', `-P${dbPort}`, '-e', `DROP DATABASE IF EXISTS ${DB}`], { stdio: 'ignore' });
  step("1. main's jar on an empty database: real Turns and empty Sessions");
  const m1 = await start('base-server.jar', 'main1');
  results.mainFlyway = m1.flyway;
  const real = [];
  for (let i = 0; i < 3; i++) {
    const r = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: `real turn ${i} on main` }] });
    real.push(r.json.id);
  }
  await settledAll();
  for (const id of real) await api('POST', `/v1/agents/sessions/${id}/events`, { type: 'agent.session.input.message', input: [{ type: 'text', text: 'second real turn on main' }] });
  await settledAll();
  const synthetic = [];
  for (let i = 0; i < Number(process.env.SYNTH ?? 60); i++) synthetic.push((await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [] })).json.id);
  await settledAll();
  await stop();

  step('2. randomized legacy events appended by SQL (V13 columns only)');
  const gen = execFileSync('node', [`${SP}/rig/legacy-gen.mjs`, tenant, process.env.SEED ?? '12840', ...synthetic], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  const genFile = `${SP}/out/legacy-${label}.sql`;
  fs.writeFileSync(genFile, gen);
  sqlFile(genFile);
  const stats = execFileSync('/bin/sh', ['-c', `node ${SP}/rig/legacy-gen.mjs ${tenant} ${process.env.SEED ?? '12840'} ${synthetic.join(' ')} 2>&1 >/dev/null`]).toString().trim();
  results.legacy = JSON.parse(stats);
  console.log(`   ${stats}`);

  step("3. main's jar materializes the legacy events");
  await start('base-server.jar', 'main2');
  results.materializeMs = await settledAll();
  await stop();
  results.before = {
    events: Number(sql(`SELECT COUNT(*) FROM managed_agent_event WHERE tenant_id = '${tenant}'`)),
    items: Number(sql(`SELECT COUNT(*) FROM managed_agent_item WHERE tenant_id = '${tenant}'`)),
    parts: Number(sql(`SELECT COUNT(*) FROM managed_agent_item_part WHERE tenant_id = '${tenant}'`)),
    columns: sql(`SELECT GROUP_CONCAT(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${DB}' AND table_name = 'managed_agent_event'`),
  };
  console.log(`   before: ${JSON.stringify(results.before)}`);

  step('4. the PR jar migrates V14 + V15');
  const p1 = await start(process.env.PRJAR ?? 'pr-server.jar', 'pr1');
  results.prFlyway = p1.flyway;
  results.history = sql("SELECT CONCAT(version, ' ', type, ' ', script, ' ', execution_time, 'ms ', success) FROM flyway_schema_history WHERE version IN ('14','15') ORDER BY installed_rank").split('\n');
  console.log(`   ${results.history.join(' | ')}`);
  record('V15 is recorded as a JDBC (Java) migration from the packaged jar', results.history.some((h) => /^15 JDBC db\.migration\.V15__managed_event_identity \d+ms 1$/.test(h)), results.history);
  await stop();

  step("5. backfilled identity vs main's Snapshot");
  const events = rows(`SELECT JSON_OBJECT('s', session_id, 'q', sequence_id, 't', event_type, 'turn', turn_id, 'item', item_id, 'part', content_part_id, 'sv', schema_version, 'pv', projection_version, 'data', data_json) FROM managed_agent_event WHERE tenant_id = '${tenant}' ORDER BY session_id, sequence_id`);
  const items = rows(`SELECT JSON_OBJECT('s', session_id, 'item', item_id, 'type', item_type) FROM managed_agent_item WHERE tenant_id = '${tenant}'`);
  const parts = rows(`SELECT JSON_OBJECT('s', session_id, 'item', item_id, 'part', part_id, 'type', part_type, 'text', part_text) FROM managed_agent_item_part WHERE tenant_id = '${tenant}'`);
  const itemKey = new Map(items.map((i) => [`${i.s}/${i.item}`, i]));
  const partKey = new Map(parts.map((p) => [`${p.s}/${p.item}/${p.part}`, p]));
  const data = (e) => (typeof e.data === 'string' ? JSON.parse(e.data) : e.data);
  const isDelta = (t) => t === 'item.output_text.delta' || t === 'item.reasoning.delta';
  const problems = { versions: [], itemMissing: [], partMissing: [], deltaNoIdentity: [], emptyWithIdentity: [], acceptedNoItem: [], toolNoItem: [], toolNotToolItem: [], otherWithIdentity: [], textMismatch: [] };
  const rebuilt = new Map();
  for (const e of events) {
    const d = data(e);
    if (e.sv !== 1 || e.pv !== 1) problems.versions.push(e.q);
    if (e.item && !itemKey.has(`${e.s}/${e.item}`)) problems.itemMissing.push(`${e.s.slice(0, 8)}#${e.q}`);
    if (e.part && !partKey.has(`${e.s}/${e.item}/${e.part}`)) problems.partMissing.push(`${e.s.slice(0, 8)}#${e.q}`);
    if (isDelta(e.t)) {
      const empty = !d.text;
      if (!empty && (!e.item || !e.part)) problems.deltaNoIdentity.push(`${e.s.slice(0, 8)}#${e.q}`);
      if (empty && (e.item || e.part)) problems.emptyWithIdentity.push(`${e.s.slice(0, 8)}#${e.q}`);
      if (e.part) rebuilt.set(`${e.s}/${e.item}/${e.part}`, (rebuilt.get(`${e.s}/${e.item}/${e.part}`) ?? '') + d.text);
    } else if (e.t === 'turn.accepted') {
      if (!e.item || e.part) problems.acceptedNoItem.push(`${e.s.slice(0, 8)}#${e.q}`);
    } else if (e.t === 'item.tool_call.updated') {
      if (!e.item) problems.toolNoItem.push(`${e.s.slice(0, 8)}#${e.q}`);
      else if (itemKey.get(`${e.s}/${e.item}`)?.type !== 'tool_call') problems.toolNotToolItem.push(`${e.s.slice(0, 8)}#${e.q}`);
    } else if (e.item || e.part) problems.otherWithIdentity.push(`${e.s.slice(0, 8)}#${e.q} ${e.t}`);
  }
  const textParts = parts.filter((p) => p.type === 'output_text' || p.type === 'reasoning');
  for (const p of textParts) if (rebuilt.get(`${p.s}/${p.item}/${p.part}`) !== p.text) problems.textMismatch.push(`${p.s.slice(0, 8)}/${p.part}`);
  const counts = Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, v.length]));
  results.differential = { events: events.length, withItem: events.filter((e) => e.item).length, withPart: events.filter((e) => e.part).length, items: items.length, textParts: textParts.length, problems: counts, samples: Object.fromEntries(Object.entries(problems).filter(([, v]) => v.length).map(([k, v]) => [k, v.slice(0, 5)])) };
  record(`backfill vs main's Snapshot: ${events.length} events, ${textParts.length} text Parts, 0 disagreements`, Object.values(counts).every((n) => n === 0), results.differential);
  const distinctParts = new Set(events.filter((e) => e.part).map((e) => `${e.s}/${e.item}/${e.part}`));
  record('every text Part of the Snapshot is named by at least one event', textParts.every((p) => distinctParts.has(`${p.s}/${p.item}/${p.part}`)), { textParts: textParts.length, named: distinctParts.size });

  step("6. rollback: main's jar on the V15 schema writes, then the PR jar again");
  let rollback;
  try {
    rollback = await start('base-server.jar', 'main-rollback');
  } catch (e) {
    rollback = { error: String(e) };
  }
  results.rollbackStart = rollback.error ?? rollback.flyway;
  if (!rollback.error) {
    // A fresh Session: the harness keeps earlier Sessions loaded across Spring restarts (409 on load).
    const rs = (await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'turn written by main after rollback' }] })).json.id;
    await settledAll();
    await stop();
    const p2 = await start(process.env.PRJAR ?? 'pr-server.jar', 'pr2');
    results.rollForwardFlyway = p2.flyway;
    const ev = await fetch(`${U}/v1/agents/sessions/${rs}/events?limit=100`, { headers: { 'X-Qwen-Tenant-Id': tenant } }).then((r) => r.json());
    const its = await fetch(`${U}/v1/agents/sessions/${rs}/items?limit=100`, { headers: { 'X-Qwen-Tenant-Id': tenant } }).then((r) => r.json());
    await stop();
    results.rollback = { session: rs, events: ev.data.map((e) => ({ seq: e.sequence, type: e.type, item_id: e.item_id ?? null, content_part_id: e.content_part_id ?? null })), items: its.data.map((i) => ({ id: i.id, parts: (i.content ?? []).map((p) => p.part_id) })) };
    console.log(results.rollback.events.map((e) => `   #${e.seq} ${e.type} item=${e.item_id} part=${e.content_part_id}`).join('\n'));
    console.log(results.rollback.items.map((i) => `   item ${i.id} parts=${i.parts.join(',')}`).join('\n'));
    const written = results.rollback.events.filter((e) => e.type === 'turn.accepted' || e.type === 'item.output_text.delta');
    record("events that main's jar wrote on the V15 schema keep no identity after roll-forward (V15 does not run again)", written.length >= 2 && written.every((e) => e.item_id === null && e.content_part_id === null), { written, snapshotItems: results.rollback.items.length });
  }
} finally {
  await stop();
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
}
