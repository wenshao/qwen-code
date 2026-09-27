// Control arms: what an authorized request gets while the saved generation cannot be reclaimed.
import * as d from './drive.mjs';
import fs from 'node:fs';
const [label, tag, timeout = '135000'] = process.argv.slice(2);
const { A, G } = JSON.parse(fs.readFileSync(`/rig/out/${label}-arms.json`, 'utf8')).arms;
const say = (...a) => console.log(d.now(), `[${tag}]`, ...a);
say('host', JSON.stringify(d.hostFacts()));
const w = await d.warm(A.sid, { timeoutMs: Number(timeout) });
say('A warm (authorized):', w.status, JSON.stringify(w.json), `${w.ms} ms`);
const b = d.sql(`SELECT storage_id, binding_state, IF(loss_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.source'))), IF(stop_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.source'))) FROM qwen_runtime_binding ORDER BY storage_id, binding_id`);
say('bindings:', b.map((r) => `${r[0]}=${r[1]}(${r[2]}/${r[3]})`).join(' '));
say('holders:', d.sql(`SELECT COUNT(*) FROM managed_workspace_execution_lease WHERE holder_key IS NOT NULL`)[0][0],
  'nonterminal executions:', d.sql(`SELECT COUNT(*) FROM qwen_tool_execution WHERE execution_state NOT IN ('SETTLED','ABANDONED')`)[0][0],
  'worker processes:', d.workers().split('\n').filter((l) => l.includes('managed-runtime-worker')).length);
