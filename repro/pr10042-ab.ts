import type { ScenarioConfig } from '../scenario-runner.js';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f48eeaf1-ac8f-4b7f-aee9-71d53222051b/scratchpad';

export default [
  {
    name: 'pr10042-real-daemon-ab',
    spawn: ['bash', '-c', `bash ${SP}/demo-ab.sh; sleep 600`],
    terminal: { title: 'PR #10042 — real qwen serve daemon boot log, base vs head (macOS)', cols: 148, rows: 30, cwd: '../../..' },
    gif: false,
    flow: [{ sleep: 150000, captureFull: 'pr10042-ab.png' }],
  },
  {
    name: 'pr10042-matrix',
    spawn: ['bash', '-c', `bash ${SP}/matrix-report.sh; sleep 600`],
    terminal: { title: 'PR #10042 — evidence matrix (real daemon runs)', cols: 132, rows: 46, cwd: '../../..' },
    gif: false,
    flow: [{ sleep: 4000, captureFull: 'pr10042-matrix.png' }],
  },
] satisfies ScenarioConfig[];
