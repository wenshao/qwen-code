// s7: write-path cost of one large real Shell publication (PUT ledger + verification leases), head vs base.
import * as L from './lib.mjs';
const ARM = process.env.ARM, SIZE = Number(process.env.SIZE ?? 256 * 1024 * 1024);
L.openLog(`s7-${ARM}${process.env.SUFFIX ?? ''}`);
const NAMES = ['Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Questions', 'Innodb_row_lock_waits'];
const snap = () => Object.fromEntries(L.sql(`SHOW GLOBAL STATUS WHERE Variable_name IN (${NAMES.map((n) => `'${n}'`).join(',')})`, 'mysql').map(([k, v]) => [k, +v]));
const s0 = snap(); const t0 = Date.now();
const m = await L.makeOutput('write', `ws-write-${ARM}${process.env.SUFFIX ?? ''}-${Date.now().toString(36)}`, process.env.ST ?? 'st-s55', L.genCmd('write', SIZE, 0, 0), { turnMs: 1_800_000, projMs: 600_000 });
const ms = Date.now() - t0; const s1 = snap();
const a = m.arts.find((x) => x.stream_role === 'stdout');
let p; try { p = L.pubRows(m.session)[0]; } catch { const r = L.sql(`SELECT publication_id, producer_phase FROM qwen_tool_publication WHERE session_id='${m.session}'`)[0]; p = { id: r[0], phase: r[1] }; }
const turnMs = +L.one(`SELECT IFNULL(completed_at - created_at, -1) FROM managed_agent_turn WHERE session_id='${m.session}'`);
const res = { arm: ARM, suffix: process.env.SUFFIX ?? '', size: SIZE, turn: m.turn.status, turnErr: m.turn.error, results: m.results, totalMs: ms, turnMs, artifactBytes: a?.byte_length ?? null, shaOk: a ? a.sha256 === L.genSha('write', 'stdout', SIZE) : false, phase: p?.phase, attempts: p ? (() => { try { return L.putAttempts(p.id); } catch { return 'n/a'; } })() : null, statements: Object.fromEntries(NAMES.map((n) => [n, s1[n] - s0[n]])) };
res.questionsPerMiB = +(res.statements.Questions / (SIZE / 1048576)).toFixed(1);
L.say('result', res);
L.out(`s7-${ARM}${process.env.SUFFIX ?? ''}.json`, res);
