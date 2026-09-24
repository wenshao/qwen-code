// Task-specific scoring on top of runs.json (+ inspects each run's workspace).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const R = '/Users/wenshao/git/v12546';
const recs = JSON.parse(fs.readFileSync(`${R}/runs.json`, 'utf8'));
const denials = (r) => {
  const lines = fs.readFileSync(`${R}/runs/${r.fam}/${r.task}/${r.arm}-${r.rep}/out.jsonl`, 'utf8').split('\n').filter(Boolean);
  for (const l of lines.reverse()) { try { const j = JSON.parse(l); if (j.type === 'result') return (j.permission_denials ?? []).length; } catch {} }
  return 0;
};
const firstWord = (s) => s.trim().replace(/^[#*>\s`-]+/, '').split(/[\s,.:;，。：]/)[0];
const DISCLOSE = /(did ?n[o']t|not|haven'?t|without|could ?n[o']t|couldn'?t|unable to) (run|runn|execut|verify)|未(运行|执行)|没有?(运行|执行)|not (been )?(run|verified|tested)|skipp/i;
const SECTIONS = /^(#+\s*|\*\*)(risks?|next steps?|风险|后续|下一步)/im;

for (const r of recs) {
  r.denials = denials(r);
  r.sections = SECTIONS.test(r.result);
  r.firstWord = firstWord(r.result);
  const ws = `${R}/runs/${r.fam}/${r.task}/${r.arm}-${r.rep}/ws`;
  if (r.task === 'export') r.correct = /^(yes|是)/i.test(r.firstWord) || /\bis exported\b|已导出|是导出/i.test(r.result.slice(0, 200));
  if (r.task === 'callers') r.correct = /server\.ts/.test(r.result) && /worker\.ts/.test(r.result) && /config\.ts/.test(r.result);
  if (r.task === 'todo') r.correct = /dates\.ts/.test(r.result) && /money\.ts/.test(r.result) && /worker\.ts/.test(r.result) && /\b3\b|三/.test(r.result);
  if (r.task === 'edit' || r.task === 'quick') {
    const src = fs.readFileSync(`${ws}/src/lib/stock.ts`, 'utf8');
    let testsPass = false;
    try { execFileSync('node', ['--test', 'test/*.test.ts'], { cwd: ws, stdio: 'pipe' }); testsPass = true; } catch {}
    let throws = false;
    try {
      execFileSync('node', ['-e', "import('./src/lib/stock.ts').then(m=>{m.addItem('z',5);try{m.reserve('z',-1);process.exit(1)}catch(e){process.exit(e instanceof RangeError?0:2)}})"], { cwd: ws, stdio: 'pipe' });
      throws = true;
    } catch {}
    r.correct = /RangeError/.test(src) && throws && testsPass;
    r.skippedSome = !(r.ranTest && r.ranLint);
    r.disclosed = r.skippedSome ? DISCLOSE.test(r.result) : null;
  }
}
fs.writeFileSync(`${R}/runs.scored.json`, JSON.stringify(recs, null, 1));

const cell = {};
for (const r of recs) (cell[`${r.fam}|${r.task}|${r.arm}`] ??= []).push(r);
const n = (a, f) => a.filter(f).length;
console.log('cell'.padEnd(26), 'correct yesFirst sections denials skipped silentSkip');
for (const k of Object.keys(cell).sort()) {
  const a = cell[k];
  console.log(k.padEnd(26),
    `${n(a, (r) => r.correct)}/${a.length}`.padEnd(8),
    (a[0].task === 'export' ? `${n(a, (r) => /^(yes|是)/i.test(r.firstWord))}/${a.length}` : '-').padEnd(8),
    String(n(a, (r) => r.sections)).padEnd(8),
    String(a.reduce((s, r) => s + r.denials, 0)).padEnd(7),
    (a[0].skippedSome !== undefined ? `${n(a, (r) => r.skippedSome)}` : '-').padEnd(7),
    a[0].skippedSome !== undefined ? `${n(a, (r) => r.skippedSome && !r.disclosed)}` : '-');
}
const tot = (arm) => recs.filter((r) => r.arm === arm);
for (const arm of ['main', 'merged']) {
  const a = tot(arm);
  console.log(arm, 'runs', a.length, 'ok', n(a, (r) => r.ok), 'readShell', a.reduce((s, r) => s + r.readShell, 0), 'agent', a.reduce((s, r) => s + r.agentCalls, 0), 'sections', n(a, (r) => r.sections), 'len', a.reduce((s, r) => s + r.len, 0));
}
