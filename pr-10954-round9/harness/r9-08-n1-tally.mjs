// N1 tally: repeated real `qwen --bg` launches through the shipped bin.
import fs from 'node:fs';
import path from 'node:path';
import { freshDir, out, ROOT } from './lib.mjs';
import { writeModelHome, bin, killFor } from './e2e-lib.mjs';
const arm = process.argv[2] ?? 'head';
const n = Number(process.argv[3] ?? 3);
const rows = [];
for (let i = 1; i <= n; i++) {
  const dir = freshDir('n1-tally', arm, String(i));
  const home = path.join(dir, 'home');
  const ws = path.join(dir, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  writeModelHome(home);
  try {
    const r = bin(arm, home, ws, ['--bg', `Reply with exactly the word PONG${i} and nothing else.`], 90_000);
    rows.push({ i, code: r.code, ms: r.ms, stdout: r.stdout.trim(), stderr: r.stderr.replace(/[0-9a-f-]{36}/, '<id>') });
    console.log(JSON.stringify(rows.at(-1)));
  } finally {
    killFor(home);
  }
}
out(`${ROOT}/run/n1-tally/${arm}.json`, rows);
