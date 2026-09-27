// Renders a figure script's real terminal output to a PNG.
// usage (from repo root): npx tsx pr11959-rig/shoot.ts <script.sh> <out.png> <title> [cols]
import { dirname, basename, resolve } from 'node:path';
import { TerminalCapture } from '../integration-tests/terminal-capture/terminal-capture.js';

const [script, out, title, cols] = process.argv.slice(2);
const baseEnv = { ...process.env };
delete baseEnv['NO_COLOR'];
const t = await TerminalCapture.create({
  cols: Number(cols ?? 132),
  rows: 16,
  theme: 'github-dark',
  chrome: true,
  title,
  cwd: process.cwd(),
  env: { ...baseEnv, FORCE_COLOR: '1', TERM: 'xterm-256color', NODE_NO_WARNINGS: '1' },
  outputDir: dirname(resolve(out!)),
});
await t.spawn('bash', ['--noprofile', '--norc', resolve(script!)]);
await t.waitFor('[figure complete]', { timeout: 900_000 });
await new Promise((r) => setTimeout(r, 500));
const file = await t.captureFull(basename(out!));
console.log(file);
await t.close();
process.exit(0);
