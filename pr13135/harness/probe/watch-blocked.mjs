// VERIFICATION RIG ONLY (PR #13135): watch prepared Sessions' close operations until all settle or timeout.
import fs from 'node:fs';
import { RIG, DB, sql, sessStatus, sleep, j, registration, Report } from './lib.mjs';
const [labels, scen, WAIT = '240000'] = process.argv.slice(2);
const rows = labels.split(',').flatMap((l) => JSON.parse(fs.readFileSync(`${RIG}/out/${DB}/prep-${l}.json`, 'utf8')).map((p) => ({ ...p, label: l })));
const rep = new Report(`watch-${scen}`);
const t0 = Date.now();
const done = new Map();
while (Date.now() - t0 < Number(WAIT) && done.size < rows.length) {
  for (const p of rows) {
    if (done.has(p.session)) continue;
    if (sessStatus(p.session) === 'CLOSED') done.set(p.session, Date.now() - t0);
  }
  await sleep(2000);
}
for (const p of rows) {
  const op = sql(`SELECT state, COALESCE(error_code,''), attempt_count FROM managed_agent_operation WHERE session_id='${p.session}' ORDER BY created_at DESC LIMIT 1`)[0];
  const b = sql(`SELECT binding_state, COALESCE(LENGTH(drain_receipt_json),0) FROM qwen_runtime_binding WHERE binding_id='${p.binding}'`)[0];
  const receipt = sql(`SELECT COALESCE(drain_receipt_json,'') FROM qwen_runtime_binding WHERE binding_id='${p.binding}'`)[0]?.[0] ?? '';
  rep.note(`${p.label}/${p.ws}: session=${sessStatus(p.session)} after=${done.get(p.session) ?? '-'}ms`, j({ op, binding: b, reg: registration(p.resourceId)?.state, receiptBoot: receipt.match(/bootId\\*":\\*"([0-9a-f-]+)/)?.[1] }));
}
rep.check('all watched closes settled CLOSED', done.size === rows.length, `${done.size}/${rows.length}`);
rep.done();
