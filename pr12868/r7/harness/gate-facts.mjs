// Writes out/fault-gate-repeat.log from the repeated runs of one fault-gate
// class (bin/gate-repeat.sh). usage: node gate-facts.mjs
import fs from 'node:fs';
import path from 'node:path';
const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const CLASS = 'DurableLocalRuntimeFaultGateTest';
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const BUILDS = { h13: 'this head ebea694e4e', h10: '50fb28301e', h9: '174f974e3e', m9: 'main 12793013c4', m8: 'main 4fddf47ee3, before #12975', tm8: 'e94f781523 + main 4fddf47ee3' };
const SETS = [
  ['by itself', (arm) => path.join(SP, 'logs', `gate-repeat-${arm}`), (arm) => path.join(SP, 'logs', arm === 'h13' ? 'gate-sequential-h13.run.log' : arm === 'h10' ? 'gate-sequential-h10.run.log' : arm === 'h9' || arm === 'm9' ? 'gate-sequential.run.log' : 'gate-sequential-before.run.log')],
  ['two builds at once', (arm) => path.join(SP, 'junk', 'r7-intermediate', `gate-repeat-${arm}-concurrent`), (arm) => path.join(SP, 'logs', `gate-concurrent-${arm}.run.log`)],
];
const lines = [];
const seen = new Map();
for (const [how, dir, runlog] of SETS) {
  for (const arm of Object.keys(BUILDS)) {
    if (!fs.existsSync(dir(arm))) continue;
    const loads = Object.fromEntries(clean(fs.readFileSync(runlog(arm), 'utf8')).split('\n').map((l) => l.match(new RegExp(`^\\[${arm}\\] run (\\d+) load=([\\d.]+)`))).filter(Boolean).map((m) => [m[1], m[2]]));
    const runs = fs.readdirSync(dir(arm)).filter((f) => f.startsWith(CLASS)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const results = [];
    for (const f of runs) {
      const text = clean(fs.readFileSync(path.join(dir(arm), f), 'utf8'));
      const total = [...text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].at(-1);
      if (!total) { results.push({ n: f, text: 'did not run' }); continue; }
      const bad = Number(total[2]) + Number(total[3]);
      for (const m of text.matchAll(/^\[ERROR\]   \w+\.(\w+):(\d+) (.*)$/gm)) {
        const key = `${m[1]}:${m[2]} ${m[3].replace(/^.*==> /, '').trim()}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      results.push({ bad, total: Number(total[1]), load: loads[f.match(/-(\d+)\.log$/)[1]] });
    }
    const passed = results.filter((r) => r.bad === 0).length;
    lines.push(`[gate] ${how.padEnd(19)} ${BUILDS[arm].padEnd(40)} ${passed} of ${results.length} runs pass · ${results.map((r) => (r.bad === 0 ? '10 of 10 pass' : `${r.bad} of 10 fail`) + ` (load ${Math.round(Number(r.load))})`).join(', ')}`);
  }
}
for (const [key, n] of [...seen].sort((a, b) => b[1] - a[1])) lines.push(`[assertion] ${String(n).padStart(2)} times · ${key}`);
fs.writeFileSync(path.join(RIG, 'out', 'fault-gate-repeat.log'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
