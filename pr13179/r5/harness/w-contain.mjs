// VERIFICATION RIG ONLY (PR #13179): worker containment on the real Hosted path (Spring + embedded Runtime Broker +
// packaged Harness + broker-spawned packaged worker). One Session per vector; the scripted model issues the tool calls;
// the verdict is the host filesystem plus the tool result the model received.
// usage: DB=<db> node w-contain.mjs <arm-label> <vector,...>
import fs from 'node:fs';
import path from 'node:path';
import { createSession, waitTurn, ensureWorkspace, Report, j, RIG, DB, RUN, steps, modelEntries, sql } from './lib.mjs';
const [arm, list] = [process.argv[2], (process.argv[3] ?? '').split(',').filter(Boolean)];
const r = new Report(`w-contain-${arm}`);
const WSR = fs.realpathSync(`${RUN}/ws`);            // parent of every storage root (outside all of them)
const STL = process.env.ST ?? 'a';
const ROOT = `${WSR}/${STL}`;                         // the storage root = the Workspace root
const OUT = `${WSR}/outside`;                         // a directory outside the Workspace
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${WSR}/secret.txt`, `TOP-SECRET-${arm}\n`);
const exists = (p) => fs.existsSync(p);
const read = (p) => (exists(p) ? fs.readFileSync(p, 'utf8') : null);
const V = {
  'w1-write-dotdot': { steps: [['write_file', { file_path: '../../escape-w1.txt', content: `escaped-${arm}` }]], outside: () => `${WSR}/escape-w1.txt` },
  'w1-read-dotdot': { steps: [['read_file', { file_path: '../../secret.txt' }]], leak: `TOP-SECRET-${arm}` },
  'w1-edit-dotdot': { pre: () => fs.writeFileSync(`${WSR}/victim.txt`, 'victim-original\n'), steps: [['edit', { file_path: '../../victim.txt', old_string: 'victim-original', new_string: `victim-overwritten-${arm}` }]], changed: () => read(`${WSR}/victim.txt`) !== 'victim-original\n' },
  'w1-read-absolute': { steps: [['read_file', { file_path: `${WSR}/secret.txt` }]], leak: `TOP-SECRET-${arm}` },
  'w1-inside-parent': { steps: [['write_file', { file_path: '../inside-parent.txt', content: `inside-parent-${arm}` }]], inside: () => `${ROOT}/inside-parent.txt` },
  'w1-inside-child': { steps: [['write_file', { file_path: 'inside-child.txt', content: `inside-child-${arm}` }]], inside: () => `${ROOT}/child/inside-child.txt` },
  'w1-absolute': { steps: [['write_file', { file_path: `${WSR}/escape-abs.txt`, content: `abs-${arm}` }]], outside: () => `${WSR}/escape-abs.txt` },
  // A symlink that already sits in the Workspace (e.g. checked into a repository) and points outside it.
  'w2-symlink': { pre: () => { fs.rmSync(`${ROOT}/child/lnk2`, { recursive: true, force: true }); fs.symlinkSync(OUT, `${ROOT}/child/lnk2`); }, steps: [['write_file', { file_path: 'lnk2/escape-w2.txt', content: `via-link-${arm}` }]], outside: () => `${OUT}/escape-w2.txt` },
  'w2-symlink-read': { pre: () => { fs.writeFileSync(`${OUT}/outside-secret.txt`, `OUTSIDE-SECRET-${arm}\n`); fs.rmSync(`${ROOT}/child/lnk2`, { recursive: true, force: true }); fs.symlinkSync(OUT, `${ROOT}/child/lnk2`); }, steps: [['read_file', { file_path: 'lnk2/outside-secret.txt' }]], leak: `OUTSIDE-SECRET-${arm}` },
  // The same path read once while lnk4 is a real directory, then read again after another process swapped lnk4 for a link.
  'w3-stale-cache-read': {
    pre: () => { fs.writeFileSync(`${OUT}/a.txt`, `OUTSIDE-A-${arm}\n`); fs.rmSync(`${ROOT}/child/lnk4`, { recursive: true, force: true }); fs.mkdirSync(`${ROOT}/child/lnk4`); fs.writeFileSync(`${ROOT}/child/lnk4/a.txt`, 'inside-a\n'); },
    steps: [
      ['read_file', { file_path: 'lnk4/a.txt' }],
      ['read_file', { file_path: 'lnk4/a.txt' }, { sleepMs: 6000 }],
      ['read_file', { file_path: 'lnk4/../lnk4/a.txt' }],
    ],
    during: async (mark) => {
      for (let i = 0; i < 300 && !modelEntries().slice(mark).some((e) => e.kind === 'STEPS' && e.rounds === 1); i++) await new Promise((r) => setTimeout(r, 100));
      const dir = `${ROOT}/child/lnk4`;
      fs.rmSync(dir, { recursive: true, force: true }); fs.symlinkSync(OUT, dir);
      return { swappedAfterFirstRead: new Date().toISOString() };
    },
    leak: `OUTSIDE-A-${arm}`,
  },
  // A real directory checked once, then swapped for a link by another process before the same path is written again.
  'w3-stale-cache': {
    pre: () => { fs.rmSync(`${ROOT}/child/lnk3`, { recursive: true, force: true }); fs.mkdirSync(`${ROOT}/child/lnk3`); },
    steps: [
      ['write_file', { file_path: 'lnk3/a.txt', content: `first-${arm}` }],
      ['write_file', { file_path: 'lnk3/a.txt', content: `second-${arm}` }, { sleepMs: 6000 }],
      ['write_file', { file_path: 'lnk3/b.txt', content: `fresh-${arm}` }],
    ],
    during: async (mark) => {
      const dir = `${ROOT}/child/lnk3`;
      // swap only after the first write's result reached the model (swapping mid-commit makes the outcome unknown)
      for (let i = 0; i < 300 && !modelEntries().slice(mark).some((e) => e.kind === 'STEPS' && e.rounds === 1); i++) await new Promise((r) => setTimeout(r, 100));
      const first = read(`${dir}/a.txt`);
      fs.rmSync(dir, { recursive: true, force: true }); fs.symlinkSync(OUT, dir);
      return { firstWriteSeen: first, swappedAt: new Date().toISOString() };
    },
    outside: () => `${OUT}/a.txt`, outside2: () => `${OUT}/b.txt`,
  },
};
const WS = process.env.WS ?? 'ws-a';
ensureWorkspace(WS, `st-${STL}`);
for (const name of list) {
  const v = V[name];
  for (const f of [v.outside?.(), v.outside2?.(), v.inside?.()].filter(Boolean)) fs.rmSync(f, { force: true });
  v.pre?.();
  const mark = modelEntries().length;
  const c = await createSession('public', WS, steps(v.steps));
  const during = v.during ? await v.during(mark) : undefined;
  const t = await waitTurn(c.session, { timeoutMs: 120_000 });
  const results = modelEntries().slice(mark).filter((e) => e.kind === 'STEPS').flatMap((e) => e.results);
  const lastResults = modelEntries().slice(mark).filter((e) => e.kind === 'STEPS').at(-1)?.results ?? [];
  const row = { arm, vector: name, session: c.session, turn: t.status, turnError: t.error, results: lastResults.map((x) => x.slice(0, 220)), ...(during ? { during } : {}) };
  if (v.outside) row.outsideFile = read(v.outside());
  if (v.outside2) row.outsideFile2 = read(v.outside2());
  if (v.inside) row.insideFile = read(v.inside());
  if (v.leak) { row.secretReachedModel = lastResults.some((x) => x.includes(v.leak)); row.leakAtStep = lastResults.map((x) => x.includes(v.leak)); }
  if (v.changed) row.victim = read(`${WSR}/victim.txt`);
  r.say(`ROW ${JSON.stringify(row)}`);
  r.rows.push(row);
}
r.done();
