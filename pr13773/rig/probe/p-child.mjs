// VERIFICATION RIG ONLY (PR #13773): hosted child-agent admission against a restored Hook owner, through Spring.
// PHASE=setup  SCEN=<json list>  : create one Spring Session per scenario, flip it to hosted-workspace-shell/1, inject the
//                                  scenario's Hook catalog pin into Spring's POST /session, run a setup turn.
// PHASE=agent                    : (after a Harness restart) one G_AGENT turn per scenario, snapshot each; then wait out the
//                                  child turn deadline and take a final snapshot.
import fs from 'node:fs';
import { api, sql, closeDb, uid, j, LOGD, VARRUN, OUT, setTapRules, waitTurns, sleep, ensureWorkspace, Report } from './lib.mjs';

const PHASE = process.env.PHASE;
const STATE = `${OUT}/state.json`;
const scen = JSON.parse(process.env.SCEN ?? '[]');
const pins = JSON.parse(fs.readFileSync(`${LOGD}/pins.json`, 'utf8'));
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const input = (s, text) => api('POST', `/v1/agents/sessions/${s}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text }] }, { key: uid('in') });

async function leaseRows() {
  return (await sql('SELECT storage_key, holder_key, runtime_session_id FROM managed_workspace_execution_lease')).map((r) => ({ storage: r.storage_key.slice(0, 8), holder: r.holder_key ? r.holder_key.slice(0, 8) : null, runtime: r.runtime_session_id }));
}

async function snapshot(name, s, st) {
  const childRuns = await sql("SELECT record_id, task_kind, task_state, runtime_state, delivery_state FROM qwen_managed_session_extension_record WHERE session_id=? AND domain='child_run'", [s]);
  const relay = await sql('SELECT child_session_id, state, attempts, COALESCE(last_error,"") AS err FROM qwen_managed_child_result_relay WHERE parent_session_id=?', [s]);
  const kids = await sql('SELECT session_id, status FROM managed_agent_session WHERE parent_session_id=?', [s]);
  const kidTurns = [];
  for (const k of kids) kidTurns.push(...(await sql('SELECT turn_id, prompt_id, status, COALESCE(error_code,"") AS err, TIMESTAMPDIFF(SECOND, created_at, COALESCE(completed_at, UTC_TIMESTAMP())) AS secs FROM managed_agent_turn WHERE session_id=? ORDER BY created_at', [k.session_id])));
  const tasks = await api('GET', `/v1/agents/sessions/${s}/tasks`);
  const model = lines(`${LOGD}/model-requests.jsonl`);
  const parentAnswer = model.filter((e) => e.kind === 'AGENT' && e.tag === name && e.rounds === 1).map((e) => e.results[0]).at(-1) ?? null;
  const childReq = model.filter((e) => e.kind === 'CHILD' && e.tag === name);
  const childFile = fs.existsSync(`${VARRUN}/ws/${st.replace('st-', '')}/child/child-${name}.txt`);
  const hookRuns = lines(`${LOGD}/hooks-rec.jsonl`).filter((h) => h.session === s).map((h) => h.event);
  const btap = lines(`${LOGD}/broker-tap.jsonl`);
  const kidIds = [...kids.map((k) => k.session_id), ...kidTurns.map((t) => t.prompt_id).filter(Boolean)];
  const busy = btap.filter((e) => e.status === 409 && kidIds.some((id) => JSON.stringify(e.body ?? {}).includes(id) || e.path.includes(id)) && JSON.stringify(e.upstreamBody ?? {}).includes('workspace_busy')).length;
  const hlog = fs.readdirSync(LOGD).filter((f) => f.startsWith('harness-')).map((f) => fs.readFileSync(`${LOGD}/${f}`, 'utf8')).join('\n');
  const waits = hlog.split('\n').filter((l) => /waits for the Workspace mount held by another Session/.test(l) && kidIds.some((id) => l.includes(id))).length;
  return {
    parentTurns: (await sql('SELECT status, COALESCE(error_code,"") AS err FROM managed_agent_turn WHERE session_id=? ORDER BY created_at', [s])).map((t) => `${t.status}${t.err ? ':' + t.err : ''}`),
    parentAnswer: parentAnswer?.slice(0, 420) ?? null,
    childRuns: childRuns.map((r) => `${r.task_kind}/${r.task_state}/${r.runtime_state ?? ''}`),
    tasks: tasks.status === 200 ? (tasks.json.data ?? tasks.json.items ?? []).map((t) => `${t.kind ?? t.task_kind}/${t.status ?? t.state}`) : `http ${tasks.status}`,
    relay: relay.map((r) => `${r.state} attempts=${r.attempts}${r.err ? ' err=' + r.err.slice(0, 80) : ''}`),
    childSessions: kids.map((k) => k.status),
    childTurns: kidTurns.map((t) => `${t.status}${t.err ? ':' + t.err : ''} ${t.secs}s`),
    childModelRequests: childReq.length,
    childWriteResult: childReq.find((e) => e.rounds === 1)?.results?.[0]?.slice(0, 160) ?? null,
    childFile,
    brokerBusy409ForChild: busy,
    harnessWaitLinesForChild: waits,
    hookRuns,
    leases: await leaseRows(),
  };
}

if (PHASE === 'setup') {
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
  const rules = [];
  for (const sc of scen) {
    await ensureWorkspace(sc.ws, sc.st);
    const r = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: sc.ws, cwd_relative: 'child' } }, { key: uid('create') });
    const s = r.json.id;
    await sql("UPDATE managed_agent_session SET tool_profile='hosted-workspace-shell/1' WHERE session_id=?", [s]);
    if (sc.cat) rules.push({ match: '^POST /session$', bodyMatch: s, action: 'inject', times: 99, merge: { hookCatalog: pins[sc.cat] } });
    state[sc.name] = { ...sc, session: s };
    console.log(`prep ${sc.name} session=${s} ws=${sc.ws} cat=${sc.cat ?? 'none'}`);
  }
  setTapRules(rules);
  await sleep(500);
  for (const sc of scen) {
    const s = state[sc.name].session;
    const r = await input(s, sc.setupText ?? `PLAIN setup ${sc.name}`);
    const w = await waitTurns(s, 1, 150_000);
    const injected = lines(`${LOGD}/tap.jsonl`).some((e) => e.injected && e.body?.sessionId === s);
    console.log(`prep ${sc.name} setup input=${r.status} turn=${w.rows.map((x) => x.status).join(',')} injected=${injected} hookRuns=${j(lines(`${LOGD}/hooks-rec.jsonl`).filter((h) => h.session === s).map((h) => h.event))}`);
  }
  console.log(`prep leases after setup ${j(await leaseRows())}`);
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
} else if (PHASE === 'agent') {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const rep = new Report(process.env.NAME ?? 'agent');
  rep.note('leases before agent turns (after Harness restart)', await leaseRows());
  const snaps = {};
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const sc of Object.values(state).filter((x) => !only || only.includes(x.name))) {
    const n = (await sql('SELECT COUNT(*) AS n FROM managed_agent_turn WHERE session_id=?', [sc.session]))[0].n;
    const t0 = Date.now();
    const r = await input(sc.session, `G_AGENT bg=${sc.bg} tag=${sc.name}`);
    const w = await waitTurns(sc.session, Number(n) + 1, Number(process.env.PARENT_WAIT_MS ?? 150_000));
    const parentMs = Date.now() - t0;
    await sleep(Number(process.env.SETTLE_MS ?? 15_000));
    snaps[sc.name] = { early: await snapshot(sc.name, sc.session, sc.st), parentMs, input: r.status, parentTimeout: !!w.timeout };
    rep.note(`${sc.name} (${sc.cat ?? 'no catalog'}, bg=${sc.bg}) early, parent turn ${parentMs} ms`, snaps[sc.name].early);
  }
  const waitMs = Number(process.env.FINAL_WAIT_MS ?? 100_000);
  rep.note(`waiting ${waitMs} ms past the child turn deadline`);
  await sleep(waitMs);
  for (const sc of Object.values(state).filter((x) => snaps[x.name])) {
    snaps[sc.name].final = await snapshot(sc.name, sc.session, sc.st);
    rep.note(`${sc.name} final`, snaps[sc.name].final);
  }
  fs.writeFileSync(`${OUT}/${rep.name}-snaps.json`, JSON.stringify(snaps, null, 1));
  rep.done({ snaps });
}
await closeDb();
