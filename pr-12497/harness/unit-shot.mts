import { TerminalCapture } from '/root/verify/pr12497/head/integration-tests/terminal-capture/terminal-capture.js';
const t = await TerminalCapture.create({ cols: 150, rows: 20, cwd: '/root/verify/pr12497/head', theme: 'dracula', chrome: true, title: 'PR #12497 — mutant M3 against the base vs PR unit table' , env: { ...process.env, FORCE_COLOR: '1' } });
await t.spawn('bash', ['/root/verify/pr12497/harness/unit-demo.sh']);
await t.waitFor('failed | 30 passed', { timeout: 120000 });
await t.idle(800, 5000);
await t.capture('D-unit-M3-base-vs-head.png', '/root/verify/pr12497/out');
await t.close();
