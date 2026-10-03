// R15-2: `--bg` is advertised by `qwen --help`, but only a LEADING `--bg`
// is intercepted. What does the real parser do with it anywhere else?
// The home points at a dead local endpoint, so anything that does get
// past the parser fails fast on the network instead of reaching a model.
//   node r10-03-bg-position.mjs head
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import { bin, killFor } from './e2e-lib.mjs';

const arm = process.argv[2] ?? 'head';
const dir = freshDir('bg-position', arm);
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(
  path.join(home, 'settings.json'),
  JSON.stringify({
    security: { auth: { selectedType: 'openai', apiKey: 'sk-dead', baseUrl: 'http://127.0.0.1:9/v1' } },
    model: { name: 'dead-model', baseUrl: 'http://127.0.0.1:9/v1' },
    ui: { hideTips: true },
  }),
);
const rows = [];
try {
  const help = bin(arm, home, ws, ['--help']);
  const helpLine = help.stdout.split('\n').find((l) => /--bg\b/.test(l));
  rows.push({ argv: 'qwen --help | grep -- --bg', code: help.code, out: helpLine?.trim() ?? '(not listed)' });
  const cases = [
    ['--model', 'dead-model', '--bg', 'audit the release'],
    ['explain', 'what', '--bg', 'does'],
    ['-p', 'hi', '--bg'],
    ['--yolo', '--bg', 'audit the release'],
  ];
  for (const c of cases) {
    const r = bin(arm, home, ws, c, 60_000);
    const shown = c.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' ');
    const errLines = r.stderr.split('\n').filter((l) => l.trim());
    rows.push({
      argv: `qwen ${shown}`,
      code: r.code,
      ms: r.ms,
      stdout: r.stdout.trim().split('\n')[0]?.slice(0, 160) ?? '',
      stderrFirst: errLines.find((l) => /Unknown argument|bg|ECONNREFUSED|error/i.test(l))?.slice(0, 200) ?? errLines[0]?.slice(0, 200) ?? '',
      stderrLines: errLines.length,
      dispatched: fs.existsSync(path.join(home, 'jobs')),
    });
    console.log(JSON.stringify(rows.at(-1)));
  }
} finally {
  rows.push({ cleanup: killFor(home) });
  out(`${ROOT}/run/bg-position/${arm}.json`, rows);
}
