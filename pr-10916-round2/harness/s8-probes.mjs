// S8 — R5-1 in practice: a productive review turn in a real git repo. The
// model asks three yes/no questions whose "yes"/"no" answer is a silent exit 1
// (git diff --quiet → "this file changed"; command -v → "not installed"),
// reading files in between. None of them is a failure the model is stuck on.
const WS = process.env.WS;
const plan = [
  { read: 'README.md' },
  { sh: 'git diff --quiet -- src/a.js' },
  { read: 'src/a.js' },
  { sh: 'git diff --quiet -- src/b.js' },
  { read: 'src/b.js' },
  { sh: 'command -v yq' },
  { read: 'package.json' },
];
export function respond({ step }) {
  const p = plan[step];
  if (!p) return { content: 'REVIEW: src/a.js and src/b.js both changed (a: new mul export, b: renamed helper); yq is not installed so I parsed package.json directly.' };
  const id = `call_s8_${step}`;
  if (p.sh) return { toolCalls: [{ id, name: 'run_shell_command', args: { command: p.sh, description: 'check state' } }] };
  return { toolCalls: [{ id, name: 'read_file', args: { file_path: `${WS}/${p.read}` } }] };
}
