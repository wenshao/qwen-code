// SubagentStop hook used by S12: asks the subagent to double-check once
// (a common "verify before you stop" hook), then lets it stop.
// argv: <logFile>. Every invocation appends its stdin payload to the log.
const fs = require('node:fs');
const log = process.argv[2];
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let p = {};
  try { p = JSON.parse(input); } catch {}
  fs.appendFileSync(log, JSON.stringify({ at: Date.now(), stop_hook_active: p.stop_hook_active, agent_type: p.agent_type, last: String(p.last_assistant_message ?? '').slice(0, 120) }) + '\n');
  if (!p.stop_hook_active) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: 'STOPHOOK-CONTINUE: before you stop, confirm that notes.txt was saved.' }));
  } else {
    process.stdout.write('{}');
  }
});
