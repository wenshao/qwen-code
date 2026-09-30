// S3b — shell IS declared to the model (yolo), but a user deny rule
// (permissions.deny: ["run_shell_command(npm *)"]) blocks npm scripts. The
// denial payload is byte-identical for every npm command. The model does
// productive reads in between and ends with a summary. Question: do three
// denials spread across the run halt it?
const WS = process.env.WS;
const plan = [
  { read: 'README.md' },
  { sh: 'npm test' },
  { read: 'package.json' },
  { sh: 'npm run build' },
  { glob: '**/*.json' },
  { sh: 'npm run lint' },
  { read: 'src/index.js' },
];
export function respond({ step }) {
  const p = plan[step];
  if (!p) return { content: 'SUMMARY: package.json defines test/build/lint scripts; I could not run them in this mode, but src/index.js exports add(a,b) and README documents it.' };
  const id = `call_s3_${step}`;
  if (p.sh) return { toolCalls: [{ id, name: 'run_shell_command', args: { command: p.sh, description: 'run project script' } }] };
  if (p.read) return { toolCalls: [{ id, name: 'read_file', args: { file_path: `${WS}/${p.read}` } }] };
  if (p.glob) return { toolCalls: [{ id, name: 'glob', args: { pattern: p.glob, path: WS } }] };
}
