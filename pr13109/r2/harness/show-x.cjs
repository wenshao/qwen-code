// show-x.cjs <A.log> <B.log> -- cross-host result pair
const fs = require('fs');
const [a, b] = process.argv.slice(2).map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^RESULT x /, '')); } catch (e) { return { error: String(e).slice(0, 100) }; } });
const show = (d) => console.log(`    ${d.n} → ${d.status} (${d.seconds} s) holder=${d.holder} runtime=${d.runtime} records=${d.records}\n       ${(d.timeline ?? []).join(' | ')}`);
console.log(`  A on ${a.host} [${a.arm}] case=${a.case} servers=${a.servers} turn=${a.turn} session=${String(a.sessionId).slice(0, 8)} harnessPid=${a.harnessPid} killedAt=${a.harnessKilledAt ?? '-'}`);
if (a.detachA) show(a.detachA);
console.log(`  B on ${b.host} [${b.arm}] load=${JSON.stringify(b.load)} final=${b.final} lease=${b.lease}`);
(b.detachB ?? []).forEach(show);
if (b.error || a.error) console.log('  ERR', a.error ?? '', b.error ?? '');
