// S6b: which statements a capture issues per asset. New UUID on the fenced S6 storage, performance_schema digests truncated
// first, the capture is stopped after KILL_MS, then the top statement digests are divided by the assets recorded so far.
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
L.openLog(`s6b-digests${process.env.TAG ? '-' + process.env.TAG : ''}`);
const { say } = L;
const m = L.mountRow('a'); if (m.state !== 'FENCED') throw new Error(L.mstr(m));
const { bundle } = W.prepareBundle(`s6b${process.env.TAG ?? ''}`, { sessions: W.members('a').map((x) => x.id) });
const req = W.captureRequest({ fence: m.operation, revision: m.revision, bundle });
L.sql('TRUNCATE TABLE performance_schema.events_statements_summary_by_digest');
const r = await W.w1b('capture', req, { oss: true, label: `digests${process.env.TAG ?? ''}`, killAfterMs: Number(process.env.KILL_MS ?? 90000) });
const assets = Number(L.one(`SELECT COUNT(*) FROM managed_workspace_recovery_work WHERE operation_id='${req.operationId}' AND work_kind='ASSET'`));
const rows = L.sql(`SELECT COUNT_STAR, ROUND(SUM_TIMER_WAIT/1e9), LEFT(REPLACE(DIGEST_TEXT, '\`', ''), 150) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='${L.DB()}' ORDER BY COUNT_STAR DESC LIMIT 14`);
const total = Number(L.one(`SELECT SUM(COUNT_STAR) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='${L.DB()}'`));
say(`   ${assets} assets recorded before the stop; ${total} statements (${(total / assets).toFixed(1)} per asset)`);
const out = rows.map((x) => ({ perAsset: (Number(x[0]) / assets).toFixed(2), count: Number(x[0]), ms: Number(x[1]), sql: x[2] }));
for (const x of out) say(`   ${x.perAsset.padStart(6)}/asset ${String(x.count).padStart(7)} ${String(x.ms).padStart(6)} ms  ${x.sql}`);
fs.writeFileSync(`${L.OUT}/s6b-digests${process.env.TAG ? '-' + process.env.TAG : ''}.json`, JSON.stringify({ assets, total, top: out }, null, 1));
say('S6B-DONE');
