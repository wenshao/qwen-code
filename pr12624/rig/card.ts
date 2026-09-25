import { TerminalCapture } from '../integration-tests/terminal-capture/terminal-capture.js';
const t = await TerminalCapture.create({ cols: 112, rows: 26, cwd: process.cwd(), theme: 'github-dark', chrome: true, title: 'PR #12624 · runtime probe + test matrix', outputDir: '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/0aff697c-d233-41a4-b23b-6f19af30ded9/scratchpad/fig' });
await t.spawn('bash', ['/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/0aff697c-d233-41a4-b23b-6f19af30ded9/scratchpad/fig/evidence.sh']);
await t.waitFor('pins existing', { timeout: 20000 });
await t.idle(800, 5000);
await t.capture('pr12624-probe-evidence.png');
await t.close(); process.exit(0);
