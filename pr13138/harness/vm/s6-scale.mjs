// S6: scale. One shared storage with N_FILES generated files (in 100 directories) plus a BIG_MIB random file, the usual
// files/Shell/O2 Sessions, EXTRA_INIT more initialized files Sessions and EXTRA_UNINIT public-only Sessions (> 2 pages of 32).
// Measures capture and verify wall time, peak RSS of java and the node child, SQL statements issued (performance_schema),
// rows/bytes added to the recovery tables and bundle size.
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
L.openLog(`s6-scale${process.env.TAG ? `-${process.env.TAG}` : ''}`);
const { say } = L;
const N_FILES = Number(process.env.N_FILES ?? 20000); const BIG_MIB = Number(process.env.BIG_MIB ?? 1024);
const EXTRA_INIT = Number(process.env.EXTRA_INIT ?? 6); const EXTRA_UNINIT = Number(process.env.EXTRA_UNINIT ?? 64);
say(L.hostFacts()); say(`   N_FILES=${N_FILES} BIG_MIB=${BIG_MIB} EXTRA_INIT=${EXTRA_INIT} EXTRA_UNINIT=${EXTRA_UNINIT}`);
L.sh('bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh down; bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh up > /dev/null');
await P.rollout(['a', 'b']);
const rig = await L.startRig('s6');
const gen = `mkdir -p gen && python3 -c "import os\nfor d in range(100):\n  os.makedirs(f'gen/d{d:03d}', exist_ok=True)\nfor i in range(${N_FILES}): open(f'gen/d{i % 100:03d}/f{i:06d}.txt','w').write('line %d\\n' % i * 8)" && head -c ${BIG_MIB}M /dev/urandom > big.bin && find . | wc -l`;
const t0 = Date.now();
const { S } = await P.populate(rig, { extraShell: [gen] });
for (let i = 0; i < EXTRA_INIT; i++) { const s = new L.HSession(rig.h, await L.createSession('ws-a1'), 'ws-a1'); await s.create(L.FILES); const r = await s.prompt(`WRITE extra-${i}.txt e${i}`); const r2 = await s.prompt(`WRITE extra-${i}.txt f${i}`); await s.detach(); if (i === 0) say(`   extra initialized Session: ${P.term(r)} / ${P.term(r2)}`); }
for (let i = 0; i < EXTRA_UNINIT; i++) await L.createSession(i % 2 ? 'ws-a1' : 'ws-a2', i % 2 ? 'project' : 'project2');
say(`   populated in ${Date.now() - t0} ms; source entries=${L.sh(`find ${L.root('a')} | wc -l`)} size=${L.sh(`du -sh ${L.root('a')} | cut -f1`)}`);
const { fence, revision } = await P.offlineAndFence(rig);
const ids = W.members('a').map((m) => m.id);
say(`   members of st-a: ${ids.length} (${W.members('a').filter((m) => m.head !== '-').length} initialized)`);
const tc = Date.now(); const { bundle } = W.prepareBundle('s6', { sessions: ids }); const copyMs = Date.now() - tc;
say(`   operator copy (cp -a) took ${copyMs} ms`);
const ps = (label) => {
  const r = L.sql(`SELECT IFNULL(SUM(COUNT_STAR),0), ROUND(IFNULL(SUM(SUM_TIMER_WAIT),0)/1e12,1) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='${L.DB()}'`)[0];
  return { statements: Number(r[0]), seconds: Number(r[1]), label };
};
const resetPs = () => L.sql('TRUNCATE TABLE performance_schema.events_statements_summary_by_digest');
const tables = () => L.sql(`SELECT table_name, table_rows, ROUND((data_length+index_length)/1048576,1) FROM information_schema.tables WHERE table_schema='${L.DB()}' AND table_name LIKE 'managed_workspace_recovery_%' ORDER BY table_name`).map((r) => `${r[0].replace('managed_workspace_recovery_', '')}≈${r[1]} rows/${r[2]} MiB`).join(' ');
resetPs();
const cap = W.captureRequest({ fence, revision, bundle });
const c = await W.w1b('capture', cap, { oss: true, label: 'capture' });
const pc = ps('capture');
const wc = L.sql(`SELECT COUNT(*), ROUND(SUM(LENGTH(metadata_json))/1048576,1) FROM managed_workspace_recovery_work WHERE operation_id='${cap.operationId}'`)[0];
say(`   capture: ${c.ms} ms, ${pc.statements} SQL statements (${pc.seconds} s server time), work rows=${wc[0]} (${wc[1]} MiB metadata); bundle ${W.bundleFacts(bundle)}`);
L.sql('ANALYZE TABLE managed_workspace_recovery_work'); say(`   recovery tables: ${tables()}`);
resetPs();
const ver = W.verifyRequest(cap);
const v = await W.w1b('verify', ver, { label: 'verify' });
const pv = ps('verify');
const wv = L.sql(`SELECT COUNT(*) FROM managed_workspace_recovery_work WHERE operation_id='${ver.operationId}'`)[0][0];
say(`   verify: ${v.ms} ms, ${pv.statements} SQL statements (${pv.seconds} s server time), work rows added=${wv}`);
const insp = await W.w1b('inspect', W.inspectRequest(cap.operationId), { label: 'inspect-p1' });
const insp2 = insp.json?.nextSessionId ? await W.w1b('inspect', W.inspectRequest(cap.operationId, 'a', insp.json.nextSessionId), { label: 'inspect-p2' }) : null;
say(`   inspect pages: ${insp.json?.sessions?.length} + ${insp2?.json?.sessions?.length ?? 0} (next=${insp2?.json?.nextSessionId ?? null})`);
const entries = Number(c.json?.result?.entries ?? 0);
say('== summary');
say(`   members=${ids.length} entries=${entries} assets=${c.json?.assets} | capture ${(c.ms / 1000).toFixed(1)} s (${(c.ms / Math.max(1, c.json?.assets)).toFixed(1)} ms/asset, ${(pc.statements / Math.max(1, c.json?.assets)).toFixed(1)} SQL/asset) java≤${c.mem.javaMiB} MiB node≤${c.mem.nodeMiB} MiB | verify ${(v.ms / 1000).toFixed(1)} s java≤${v.mem.javaMiB} MiB node≤${v.mem.nodeMiB} MiB | cp -a ${(copyMs / 1000).toFixed(1)} s`);
say(`   capture: ${W.summary(c)}`); say(`   verify: ${W.summary(v)}`);
fs.writeFileSync(`${L.OUT}/s6-scale${process.env.TAG ? `-${process.env.TAG}` : ''}.json`, JSON.stringify({ N_FILES, BIG_MIB, members: ids.length, entries, assets: c.json?.assets, captureMs: c.ms, verifyMs: v.ms, copyMs, capMem: c.mem, verMem: v.mem, sqlCapture: pc, sqlVerify: pv, workRows: wc, verifyRows: wv }, null, 1));
await rig.stop(); say('S6-DONE');
