// Seeds a deterministic debug-dir fixture. No deletions anywhere.
import { mkdirSync, writeFileSync, utimesSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const home = process.argv[2];
const debugDir = join(home, 'debug');
rmSync(debugDir, { recursive: true, force: true });
mkdirSync(debugDir, { recursive: true });

const D = 24 * 60 * 60 * 1000;
const age = (p, days) => { const t = new Date(Date.now() - days * D); utimesSync(p, t, t); };
const mk = (name, days, body = 'x'.repeat(64)) => {
  const p = join(debugDir, name);
  writeFileSync(p, body);
  age(p, days);
  return p;
};

const STALE   = '11111111-1111-4111-8111-111111111111';
const RECENT  = '22222222-2222-4222-8222-222222222222';
const AGENT   = '33333333-3333-4333-8333-333333333333-agent-Explore-g2tss0';
const LINKTGT = '44444444-4444-4444-8444-444444444444'; // NOTE: version nibble 4->'4' ok

mk(`${STALE}.txt`, 60);
mk(`${RECENT}.txt`, 1);
mk(`${AGENT}.txt`, 60);
mk('notes.txt', 60);                 // invalid stem
mk(`${LINKTGT}.txt`, 60);            // target of the `latest` alias
symlinkSync(`${LINKTGT}.txt`, join(debugDir, 'latest'));

mkdirSync(join(debugDir, 'daemon'), { recursive: true });
const dl = join(debugDir, 'daemon', 'serve-1.log');
writeFileSync(dl, 'daemon');
age(dl, 60);

console.log(JSON.stringify({ debugDir, STALE, RECENT, AGENT, LINKTGT }));
