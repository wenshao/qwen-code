// S5b: the layout the README now requires — storage root outside every Git worktree, Session cwd in a child project
// directory that is its own Git repository. Durable workers, option on.
//   storage c: /srv/w1a/c (not a repository) with /srv/w1a/c/project (a repository); cwd_relative = "project".
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s5b-layout');
const { say } = L; const R = '/srv/w1a'; const MARK = '.qwen-managed-storage.json';
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-c', 'c'); L.seedWs('ws-c2', 'c');
say('layout:', L.sh(`cd ${R}/c/project && git init -q -b main . && git config user.email rig@example.invalid && git config user.name rig && echo 'build/' > .gitignore && echo hello > README.md && git add -A && git commit -q -m init && echo "project is a repository ($(git log --oneline | head -1)); root is $(cd ${R}/c && git rev-parse --show-toplevel 2>&1 | head -1 | cut -c1-60)"`));
L.svc('stop');
const op = randomUUID();
L.sayMaint('s5b-register-c', L.maint(['register', L.TENANT, 'st-c', `${R}/c`, op, '--offline-confirmed']));
say('  ', L.svc('start').split(' ===')[0]);
const rig = await L.startRig('s5b');
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const out = (r) => { for (const t of L.toolTrace(r.events)) if (t.startsWith('result')) return t.replace(/\\n/g, ' ⏎ ').slice(0, 420); return '<no tool result>'; };
const term = (r) => r.terminal?.map((t) => t.type).join(',') || '<no terminal event>';
const insp = () => L.inspect('c').out.replace(/operation=\S+ completed=\S+ /, '');
const onDisk = () => (fs.existsSync(`${R}/c/${MARK}`) ? 'present' : 'ABSENT');

const S = new L.HSession(rig.h, await L.createSession('ws-c', 'project'), 'ws-c');
say(`Shell Session S, cwd_relative "project": create=${(await S.create(L.SHELL)).status}`);
let r = await S.prompt(L.shell64('pwd; git rev-parse --show-toplevel; git status --porcelain | wc -l'));
say('1. where the agent is ->', term(r)); say('     ', out(r));
r = await S.prompt(L.shell64('mkdir -p build && echo artifact > build/out.o && echo scratch > notes.tmp && git stash -u && git status --porcelain | wc -l'));
say('2. `git stash -u` ->', term(r)); say('     ', out(r)); say(`   marker ${onDisk()}; inspect: ${insp()}`);
r = await S.prompt(L.shell64('git stash pop -q; git clean -fdx 2>&1 | tr "\\n" " "'));
say('3. `git clean -fdx` ->', term(r)); say('     ', out(r)); say(`   marker ${onDisk()}; inspect: ${insp()}`);
mark = rig.proxy.ledger.length;
r = await S.prompt(L.shell64('echo still-working > ok.txt; cat ok.txt')); say('4. next Shell Turn ->', term(r)); say('     ', out(r)); say('      broker:', since());

say('== what the layout does not change (README: "Tools are not confined by this layout")');
r = await S.prompt(L.shell64('ls -a .. | tr "\\n" " "')); say('5. `ls -a ..` ->', term(r)); say('     ', out(r));
r = await S.prompt(L.shell64(`cat ../${MARK} | cut -c1-200`)); say(`6. \`cat ../${MARK}\` ->`, term(r)); say('     ', out(r));
const F = new L.HSession(rig.h, await L.createSession('ws-c2', 'project'), 'ws-c2');
say(`file Session F (ws-c2, cwd "project"): create=${(await F.create(L.FILES)).status}`);
r = await F.prompt(`READ ../${MARK}`); say(`7. read_file ../${MARK} ->`, term(r)); say('     ', out(r));
r = await F.prompt(`WRITE ../${MARK} {}`); say(`8. write_file ../${MARK} ->`, term(r)); say('     ', out(r)); say(`   marker ${onDisk()}, ${fs.existsSync(`${R}/c/${MARK}`) ? fs.statSync(`${R}/c/${MARK}`).size : 0} bytes; inspect: ${insp()}`);
r = await F.prompt(`WRITE ${R}/c/${MARK} {}`); say(`9. write_file <absolute root>/${MARK} ->`, term(r)); say('     ', out(r)); say(`   marker ${onDisk()}, ${fs.existsSync(`${R}/c/${MARK}`) ? fs.statSync(`${R}/c/${MARK}`).size : 0} bytes; inspect: ${insp()}`);
mark = rig.proxy.ledger.length;
r = await S.prompt(L.shell64(`rm -f ../${MARK}; ls -a .. | tr "\\n" " "`)); say(`10. Shell \`rm -f ../${MARK}\` ->`, term(r)); say('     ', out(r)); say(`   marker ${onDisk()}; inspect: ${insp()}`);
r = await S.prompt(L.shell64('echo after')); say('    next Shell Turn ->', term(r)); say('      broker:', since());
const N = new L.HSession(rig.h, await L.createSession('ws-c2', 'project'), 'ws-c2');
say(`    a new Session on the same storage: create=${(await N.create(L.FILES)).status}`);
r = await N.prompt('WRITE other.txt x'); say('    its first tool Turn ->', term(r)); say('      broker:', since());

say('== what the operator has afterwards (service stopped)');
await S.detach(); await F.detach(); await N.detach(); L.svc('stop');
L.sayMaint('s5b-register-same-op', L.maint(['register', L.TENANT, 'st-c', `${R}/c`, op, '--offline-confirmed']));
L.sayMaint('s5b-register-new-op', L.maint(['register', L.TENANT, 'st-c', `${R}/c`, randomUUID(), '--offline-confirmed']));
const m = L.mountRow('c');
const body = JSON.stringify({ version: 2, tenantId: m.tenant, storageId: m.storage, root: m.root, hostId: m.hostId, device: m.device, inode: m.inode, birthTime: m.birthTime, registrationId: m.registrationId });
fs.writeFileSync(`${R}/c/${MARK}`, body);
say(`   hand-written marker from the SQL row (${body.length} bytes, 9 fields); inspect: ${insp()}`);
say('  ', L.svc('start').split(' ===')[0]); say(`   S load=${(await S.load()).status}`); mark = rig.proxy.ledger.length;
r = await S.prompt(L.shell64('echo repaired')); say('   next Shell Turn ->', term(r)); say('      broker:', since());
await rig.stop(); say('S5B-DONE');
