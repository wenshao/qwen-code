// S10 — three DIFFERENT long-running commands, each given the same explicit
// shell `timeout`, each timing out (the model then moves on to the next idea).
// The timeout error text carries no command identity:
//   "Command timed out after 3000ms before it could complete."
// Question: does the always-on guard treat three unrelated timeouts as one
// repeated error and halt a productive turn?
const WS = process.env.WS;
const plan = [
  { sh: "python3 -c 'import time; time.sleep(30)'  # full build" },
  { read: 'README.md' },
  { sh: "python3 -c 'import time; time.sleep(31)'  # integration tests" },
  { glob: '*.md' },
  { sh: "python3 -c 'import time; time.sleep(32)'  # dependency audit" },
  { read: 'README.md' },
];
export function respond({ step }) {
  const p = plan[step];
  if (!p) return { content: 'SUMMARY: build, tests and audit each exceed 3s here, so I skipped them; README describes the project.' };
  const id = `call_s10_${step}`;
  if (p.sh) return { toolCalls: [{ id, name: 'run_shell_command', args: { command: p.sh, description: 'run a long project step', timeout: 3000 } }] };
  if (p.read) return { toolCalls: [{ id, name: 'read_file', args: { file_path: `${WS}/${p.read}` } }] };
  if (p.glob) return { toolCalls: [{ id, name: 'glob', args: { pattern: p.glob, path: WS } }] };
}
