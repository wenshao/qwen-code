// S4 — an edit/re-run loop: the model re-runs the same check after each edit;
// its first two edits do not fix the problem (the check prints the same
// failure), the third would. Successful edits sit between the failing runs.
const WS = process.env.WS;
const cfg = `${WS}/config.json`;
const plan = [
  { sh: 'node check.js' },
  { read: true },
  { edit: ['"port": "3000"', '"port": "8080"'] },
  { sh: 'node check.js' },
  { edit: ['"port": "8080"', '"port": "80"'] },
  { sh: 'node check.js' },
  { edit: ['"port": "80"', '"port": 8080'] },
  { sh: 'node check.js' },
];
export function respond({ step }) {
  const p = plan[step];
  if (!p) return { content: 'DONE: config.port is now the number 8080 and `node check.js` passes.' };
  const id = `call_s4_${step}`;
  if (p.sh) return { toolCalls: [{ id, name: 'run_shell_command', args: { command: p.sh, description: 'validate config' } }] };
  if (p.read) return { toolCalls: [{ id, name: 'read_file', args: { file_path: cfg } }] };
  if (p.edit) {
    return { toolCalls: [{ id, name: 'edit', args: { file_path: cfg, old_string: p.edit[0], new_string: p.edit[1] } }] };
  }
}
