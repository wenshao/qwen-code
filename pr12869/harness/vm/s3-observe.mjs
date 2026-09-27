// After the reboot: watch the recovery converge without sending any Broker request.
import * as d from './drive.mjs';
const seconds = Number(process.argv[2] ?? 180);
const want = process.argv[3] ?? 'RELEASED';
const end = Date.now() + seconds * 1000; let last = '';
console.log(d.now(), 'host', JSON.stringify(d.hostFacts()));
while (Date.now() < end) {
  let line;
  try {
    const b = d.sql(`SELECT storage_id, binding_state, IF(loss_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(loss_evidence_json,'$.source'))), IF(stop_evidence_json IS NULL,'-',JSON_UNQUOTE(JSON_EXTRACT(stop_evidence_json,'$.source'))) FROM qwen_runtime_binding ORDER BY storage_id, runtime_generation`);
    const holders = d.sql(`SELECT COUNT(*) FROM managed_workspace_execution_lease WHERE holder_key IS NOT NULL`)[0][0];
    const open = d.sql(`SELECT COUNT(*) FROM qwen_tool_execution WHERE execution_state NOT IN ('SETTLED','ABANDONED')`)[0][0];
    const sessions = d.sql(`SELECT COUNT(*) FROM qwen_runtime_session WHERE session_state NOT IN ('RELEASED')`)[0][0];
    line = `${b.map((r) => `${r[0]}=${r[1]}(${r[2]}/${r[3]})`).join(' ')} | holders=${holders} nonterminal_executions=${open} active_runtime_sessions=${sessions}`;
    if (line !== last) { console.log(d.now(), line); last = line; }
    if (b.length && b.every((r) => r[1] === want)) break;
  } catch (error) {
    line = `database not reachable yet (${String(error.message).split('\n')[0].slice(0, 80)})`;
    if (line !== last) { console.log(d.now(), line); last = line; }
  }
  await d.sleep(500);
}
console.log(d.now(), 'observer done');
