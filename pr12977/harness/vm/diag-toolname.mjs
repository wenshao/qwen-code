// Root cause of F1 on a real record: the PR's maintenance jar, the stored reference, with and without toolName.
import * as L from './lib.mjs';
const { d } = L;
L.openLog('diag-toolname');
const say = L.say;
const [bid, gen] = d.sql("SELECT binding_id, runtime_generation FROM qwen_tool_execution WHERE JSON_EXTRACT(result_json,'$.capture.captureReason')='producer_lost' LIMIT 1")[0];
const ref = d.sql(`SELECT reference_json FROM qwen_tool_execution WHERE binding_id='${bid}'`)[0][0];
say(`stored reference_json of the real Hosted Shell call: ${ref}`);
say(`keys: ${Object.keys(JSON.parse(ref)).join(', ')}; toolName present: ${'toolName' in JSON.parse(ref)}`);
L.sayMaint('diag-1-inspect-as-stored', L.maint(['inspect', bid, gen]));
d.sql(`UPDATE qwen_tool_execution SET reference_json = JSON_SET(reference_json, '$.toolName', 'run_shell_command') WHERE binding_id='${bid}'`);
L.sayMaint('diag-2-inspect-with-toolName-added', L.maint(['inspect', bid, gen]));
d.sql(`UPDATE qwen_tool_execution SET reference_json = JSON_REMOVE(reference_json, '$.toolName') WHERE binding_id='${bid}'`);
say(`restored: toolName present again: ${'toolName' in JSON.parse(d.sql(`SELECT reference_json FROM qwen_tool_execution WHERE binding_id='${bid}'`)[0][0])}`);
L.sayMaint('diag-3-inspect-restored', L.maint(['inspect', bid, gen]));
