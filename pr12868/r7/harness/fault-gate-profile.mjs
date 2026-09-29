// Writes out/fault-gate-profile.json: the result of every run of the whole
// fault-gate profile on the head and on the trial merge, in the order they ran.
import fs from 'node:fs';
import path from 'node:path';
const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const runs = (arm) => {
  const dir = path.join(SP, 'logs', `suites-${arm}-runs`);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^fault-gates-run\d+\.log$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((f) => {
    const text = clean(fs.readFileSync(path.join(dir, f), 'utf8'));
    const t = [...text.matchAll(/^\[(?:INFO|WARNING|ERROR)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].at(-1);
    return t ? `${Number(t[1]) - Number(t[2]) - Number(t[3])}/${t[1]}` : 'did not run';
  });
};
const result = { head: runs('h13'), merge: runs('tm13') };
fs.writeFileSync(path.join(RIG, 'out', 'fault-gate-profile.json'), JSON.stringify(result));
console.log(JSON.stringify(result));
