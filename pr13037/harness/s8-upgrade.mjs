// s8: upgrade in place from main to the PR (schema o3b), then enable O3 and watch the historical backfill.
// usage: DB=o3b PHASE=main|pr-off|pr-on node s8-upgrade.mjs
import fs from 'node:fs';
import * as L from './lib.mjs';
const PHASE = process.env.PHASE;
L.openLog(`s8-${PHASE}`);
const file = `${L.R}/out/s8-upgrade.json`;
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { sessions: [] };
const setMode = (m) => fs.writeFileSync(`${L.R}/run/tap-mode.json`, JSON.stringify(m));
const shell = { shell: true, capture: 2147483648 };
L.say('schema', { flyway: L.one('SELECT MAX(CAST(version AS UNSIGNED)) FROM flyway_schema_history'), o3Tables: L.sql("SHOW TABLES LIKE 'managed_agent_tool_result'").length, headBackfillColumns: L.sql("SHOW COLUMNS FROM qwen_managed_session_journal_head LIKE 'o3_%'").length });

async function make(name, n, prompt, mode) {
  const ws = `ws-s8-${name}`;
  L.register(ws, `st-s${n}`);
  setMode(mode);
  const session = await L.createShellSession(ws, prompt);
  const turn = await L.waitTurn(session, { timeoutMs: 120000 });
  const row = { name, phase: PHASE, session, turn: turn.status, error: turn.error };
  state.sessions.push(row);
  L.say(`created ${name}`, row);
  return row;
}
async function describe(row) {
  const get = await L.api('GET', `/v1/agents/sessions/${row.session}`);
  const list = await L.api('GET', `/v1/agents/sessions/${row.session}/artifacts`);
  const ev = await L.events(row.session);
  let sources = 'table missing';
  try { sources = L.resultRows(row.session).map((r) => `${r.state}${r.failure ? '/' + r.failure : ''}`).join(',') || 'none'; } catch {}
  return { name: row.name, createdOn: row.phase, status: get.status, artifactsCapability: get.json.capabilities?.artifacts, artifactList: `${list.status} ${list.json.error?.code ?? (list.json.data?.length + ' artifacts')}`, resultEvents: ev.filter((e) => e.type === 'item.tool_result.updated').length, toolCallEvents: ev.filter((e) => e.type === 'item.tool_call.updated').length, sources, receiptsInJournal: +L.one(`SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE session_id='${row.session}' AND operation='recordToolResult'`) };
}
const base = PHASE === 'main' ? 30 : PHASE === 'pr-off' ? 36 : 42;
if (PHASE !== 'pr-on') {
  await make(`${PHASE}-shell-a`, base, L.shellPrompt('Build', 'echo compiled 12 modules; echo "warning: unused variable" >&2'), shell);
  await make(`${PHASE}-shell-b`, base + 1, L.shellPrompt('Test', `${L.NODE22} ${L.R}/loggen.mjs 40000 2 1`), shell);
  await make(`${PHASE}-shell-notstarted`, base + 2, L.shellPrompt('Wait', 'sleep 5; echo never'), shell);
  await make(`${PHASE}-files`, base + 3, 'Write the proof file [O3_FILE]', { shell: false });
  if (PHASE === 'main') await make('main-pretty', 34, 'Run the release build and tell me whether it passed. [O3_CMD:build]', shell);
  setMode(shell);
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  for (const row of state.sessions) L.say('state', await describe(row));
} else {
  // O3 has just been enabled: poll until every historical source is settled
  const t0 = Date.now();
  const seen = {};
  for (;;) {
    const heads = L.sql('SELECT COUNT(*), SUM(o3_backfill_through IS NOT NULL AND o3_backfill_revision >= o3_backfill_through), SUM(journal_revision) FROM qwen_managed_session_journal_head')[0];
    const rows = L.sql("SELECT work_state, COUNT(*) FROM managed_agent_tool_result GROUP BY 1").map((r) => r.join('=')).join(' ');
    const sec = Math.round((Date.now() - t0) / 1000);
    for (const row of state.sessions) {
      const st = L.resultRows(row.session).map((r) => r.state).join(',');
      if (st && !seen[row.name] && !/PENDING|LEASED/.test(st)) { seen[row.name] = sec; L.say('settled', { name: row.name, afterSeconds: sec, sources: st }); }
    }
    if (sec % 10 === 0) L.say('progress', { sec, heads: +heads[0], headsBackfilled: +heads[1], rows });
    if (+heads[0] === +heads[1] && !/PENDING|LEASED/.test(rows)) { L.say('backfill complete', { seconds: sec, heads: +heads[0], journalRevisionsScanned: +L.one('SELECT SUM(o3_backfill_through) FROM qwen_managed_session_journal_head'), rows }); break; }
    if (sec > 900) { L.say('backfill', 'TIMEOUT'); break; }
    await L.sleep(1000);
  }
  for (const row of state.sessions) L.say('state', await describe(row));
  L.say('errors', L.sql("SELECT COUNT(*) FROM qwen_managed_session_journal_head WHERE o3_backfill_error IS NOT NULL")[0]);
}
