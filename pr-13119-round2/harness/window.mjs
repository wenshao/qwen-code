// Per-save exposure: wall time of one writeWithBackupSync call (a crash inside it can leave artifacts).
import fs from 'node:fs';
const [arm, file] = process.argv.slice(2);
const m = await import(`/root/verify/pr13119/${arm}/packages/cli/dist/src/utils/${file}`);
const D = `/root/verify/pr13119/r2/win/${arm}`; fs.rmSync(D, { recursive: true, force: true }); fs.mkdirSync(D, { recursive: true });
const T = `${D}/settings.json`; const body = fs.readFileSync('/root/verify/pr13119/run/settings.initial.json', 'utf8');
fs.writeFileSync(T, body);
const t = [];
for (let i = 0; i < 3000; i++) { const s = process.hrtime.bigint(); m.writeWithBackupSync(T, body.replace('GitHub', `t${i}`)); t.push(Number(process.hrtime.bigint() - s) / 1000); }
t.sort((a, b) => a - b);
const q = (p) => t[Math.floor(p * (t.length - 1))].toFixed(0);
console.log(JSON.stringify({ arm, saves: t.length, p50_us: q(0.5), p90_us: q(0.9), p99_us: q(0.99), leftovers: fs.readdirSync(D).length - 1 }));
