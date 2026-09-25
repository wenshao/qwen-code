import { TerminalCapture } from '../integration-tests/terminal-capture/terminal-capture.js';
const t = await TerminalCapture.create({ cols: 112, rows: 25, cwd: process.cwd(), theme: 'github-dark', chrome: true, title: 'PR #12624 round 2 · runtime probe + mutation matrix', outputDir: '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/0aff697c-d233-41a4-b23b-6f19af30ded9/scratchpad/r2/fig' });
await t.spawn('bash', ['/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/0aff697c-d233-41a4-b23b-6f19af30ded9/scratchpad/r2/fig/evidence.sh']);
await t.waitFor('mutants killed', { timeout: 20000 });
await t.idle(800, 5000);
await t.capture('r2-probe-and-mutants.png');
await t.close(); process.exit(0);
