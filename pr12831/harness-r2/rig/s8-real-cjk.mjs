// Real model reads a real Chinese design document from this repository
// (docs/design/2026-09-10-opentui-parity-defect-sweep.zh-CN.md, copied into ws-w).
import fs from 'node:fs';
import * as L from './lib.mjs';
const DB = 'rig3';
const HTTP = 18833;
const ST = process.argv[2] ?? 'w';
L.openLog(`s8-real-cjk-${process.env.ARM ?? 'r2'}-${ST}`);
const proxy = await L.startBrokerProxy('http://127.0.0.1:19833');
const h = await new L.Harness({ name: `real-cjk-${ST}`, brokerUrl: proxy.url, realModel: process.env.REAL_MODEL ?? 'qwen3.8-max' }).start();
try {
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='ws-${ST}'`)[0][0] === '0') L.seedRegistry(DB, `ws-${ST}`, `st-${ST}`);
  const f = `${L.RIG}/roots3/${ST}/child/defect-sweep.zh-CN.md`;
  L.say('doc', `${fs.statSync(f).size} bytes, ${[...fs.readFileSync(f, 'utf8')].length} chars`);
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, `ws-${ST}`), L.storeConnection(h, `ws-${ST}`, HTTP));
  await s.create();
  const t0 = Date.now();
  const r = await s.prompt('请用 read_file 阅读 defect-sweep.zh-CN.md，然后用三句话概括它的内容。');
  L.say('turn', L.summarizeTurn(r));
  for (const t of L.toolTrace(r.events ?? [])) L.say('tool', t);
  L.say('text', L.assistantText(r.events ?? []).replace(/\s+/g, ' ').slice(0, 200));
  for (const l of L.ledgerSince(proxy.ledger, t0).filter((x) => !x.startsWith('GET'))) L.say('broker', l);
  L.say('harness', h.log().split('\n').filter((l) => /recovery blocked|failed:/.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || ') || '<none>');
  L.say('state', `execution rows=${JSON.stringify(L.sql(DB, "SELECT execution_state, IFNULL(execution_status,'-'), COUNT(*) FROM qwen_tool_execution GROUP BY 1,2"))}; held=${JSON.stringify(L.holders(DB).filter((x) => x[1] !== '<none>').map((x) => x[1].slice(0, 8)))}`);
  const again = await s.submit('还在吗？');
  L.say('next prompt', `${again.status} ${again.status === 202 ? '' : JSON.stringify(again.json)}`);
} finally {
  await h.stop();
  await proxy.close();
}
