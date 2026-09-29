// S1: the runbook end to end on a real Linux durable worker, with a real escaped writer.
// Service = PR head jar. Maintenance command = MAINT_JAR (head, or head + candidate capture fix).
import fs from 'node:fs';
import * as L from './lib.mjs';
const { d } = L;
const tag = process.argv[2] ?? 's1';
L.openLog(tag);
const say = L.say;
const facts = {};
L.seedWs('a'); L.seedWs('b');
say(`== ${tag}: service jar=${L.env().JAR} durable=${L.env().DURABLE} trusted=${L.env().TRUSTED} db=${d.DB}; maintenance jar=${L.MAINT_JAR}`);
say(`host: ${JSON.stringify(d.hostFacts())}`);
const rig = await L.startHarness(tag);
const ledgerSince = (t0) => rig.proxy.ledger.filter((e) => e.received >= t0 && e.status !== 200).map((e) => `${e.method} ${e.url} -> ${e.status} ${e.code ?? ''}`).join('; ');
const turn = async (label, s, text) => { const t0 = Date.now(); const r = await s.prompt(text); say(`${label}:`, L.turnSummary(r)); const l = ledgerSince(t0); if (l) say(`      broker non-200: ${l}`); return r; };
try {
  // ---------------- Phase A: the incident
  say('-- Phase A: incident (Session A runs a Shell command whose setsid descendant keeps the capture pipe)');
  const A = await L.shellSession(rig.h, 'ws-a');
  await turn('A turn 1 "ESCAPE"', A, 'ESCAPE');
  const bA = L.binding(A.sessionId); facts.bindingA = bA;
  say(L.bstr(bA)); say(L.hstr(L.holder('a')));
  for (const e of L.executions(bA.id)) say('  execution', e.join(' | '));
  const writer = L.escapedPids()[0];
  const regA = L.registrations().find((r) => r.state && JSON.parse(r.handle).resourceId && fs.existsSync(`/proc/${r.pid}`) && L.workerPids().includes(r.pid) && d.sql(`SELECT COUNT(*) FROM qwen_runtime_binding WHERE binding_id='${bA.id}' AND resource_handle_json LIKE '%${JSON.parse(r.handle).resourceId}%'`)[0][0] === '1');
  const workerA = regA?.pid;
  say(`registered worker of A: pid=${workerA} ${JSON.stringify(L.procIds(workerA))}; escaped writer pid=${writer} ${JSON.stringify(L.procIds(writer))}`);
  let m0 = L.markerLines('a'); await L.sleep(2000); say(`escaped-marker grows while nothing is recovered: ${m0} -> ${L.markerLines('a')} lines in 2 s`);
  const B = await L.shellSession(rig.h, 'ws-a');
  await turn('B turn 1 "HELLO bob" (second Session, same Workspace)', B, 'HELLO bob');
  const C = await L.shellSession(rig.h, 'ws-b');
  await turn('C turn 1 "HELLO carol" (control: other Workspace)', C, 'HELLO carol');

  // ---------------- Phase B: inspect / prepare
  say('-- Phase B: inspect and prepare');
  L.sayMaint('inspect-wrong-generation', L.maint(['inspect', bA.id, String(bA.gen + 1)]));
  const ins = L.sayMaint('inspect', L.maint(['inspect', bA.id, String(bA.gen)]));
  let inspection = null; try { inspection = JSON.parse(ins.result); } catch { /* refused */ }
  const leak = ['rootpw', '<rig-credential-key-prefix>', 'rig-broker-token'].filter((s) => ins.stdout.includes(s) || ins.stderr.includes(s));
  say(`  inspect output mentions a secret: ${leak.length ? leak.join(',') : 'no'}; stdout lines=${ins.stdout.split('\n').filter(Boolean).length}`);
  if (!inspection) { say('!! inspect refused: the procedure cannot start on this record'); facts.blockedAt = 'inspect'; throw new Error('stop'); }
  L.sayMaint('prepare-wrong-holder', L.maint(['prepare', bA.id, String(bA.gen), '0'.repeat(64), 'INC-12977 escaped writer']));
  say(L.bstr(L.binding(A.sessionId))); say(L.astr());
  const prep = L.sayMaint('prepare', L.maint(['prepare', bA.id, String(bA.gen), inspection.holderKey, 'INC-12977 escaped writer']));
  const recoveryId = prep.result.trim(); facts.recoveryId = recoveryId;
  say(L.bstr(L.binding(A.sessionId))); say(L.hstr(L.holder('a'))); say(L.astr());
  L.sayMaint('prepare-repeat', L.maint(['prepare', bA.id, String(bA.gen), inspection.holderKey, 'INC-12977 escaped writer']));
  L.sayMaint('prepare-other-reason', L.maint(['prepare', bA.id, String(bA.gen), inspection.holderKey, 'a different reason']));
  L.sayMaint('inspect-after-prepare', L.maint(['inspect', bA.id, String(bA.gen)]));

  say('-- fence while prepared (worker and writer still running)');
  await turn('B turn 2 "HELLO bob"', B, 'HELLO bob');
  await turn('A turn 2 "HELLO alice" (original Session)', A, 'HELLO alice');
  const D = await L.shellSession(rig.h, 'ws-a');
  await turn('D turn 1 "HELLO dave" (new Session, same Workspace)', D, 'HELLO dave');
  await turn('C turn 2 "HELLO carol2" (other Workspace)', C, 'HELLO carol2');
  say(L.bstr(L.binding(A.sessionId))); say(L.hstr(L.holder('a')));

  say('-- evidence checks (worker still alive)');
  const sd = L.stateDir();
  L.sayMaint('complete-missing-file', L.maint(['complete', recoveryId, `${sd}/no-such.json`]));
  L.sayMaint('complete-mode-0644', L.maint(['complete', recoveryId, L.writeEvidence('ev-0644.json', recoveryId, {}, 0o644)]));
  const good = L.writeEvidence('ev-good.json', recoveryId);
  fs.rmSync(`${sd}/ev-link.json`, { force: true }); fs.symlinkSync(good, `${sd}/ev-link.json`);
  L.sayMaint('complete-symlink', L.maint(['complete', recoveryId, `${sd}/ev-link.json`]));
  fs.writeFileSync('/tmp/ev-outside.json', fs.readFileSync(good), { mode: 0o600 }); fs.chmodSync('/tmp/ev-outside.json', 0o600);
  L.sayMaint('complete-outside-state-dir', L.maint(['complete', recoveryId, '/tmp/ev-outside.json']));
  L.sayMaint('complete-other-recoveryId', L.maint(['complete', recoveryId, L.writeEvidence('ev-other.json', '00000000-0000-0000-0000-000000000000')]));
  L.sayMaint('complete-restartPrevention-false', L.maint(['complete', recoveryId, L.writeEvidence('ev-rp.json', recoveryId, { restartPrevention: false })]));
  L.sayMaint('complete-worker-alive', L.maint(['complete', recoveryId, good]));
  say(L.bstr(L.binding(A.sessionId))); say(L.hstr(L.holder('a'))); say(L.astr());
  say(`registration of A: ${JSON.stringify(L.registrations().filter((r) => r.pid === workerA).map((r) => ({ state: r.state, pid: r.pid })))}`);

  // ---------------- Phase C: the operator stops every writer
  say('-- Phase C: operator stops the registered worker, then looks for other writers');
  process.kill(workerA, 'SIGKILL'); await L.sleep(1500);
  say(`worker ${workerA} alive: ${fs.existsSync(`/proc/${workerA}`)}`);
  m0 = L.markerLines('a'); await L.sleep(2000); say(`escaped-marker after the worker is gone: ${m0} -> ${L.markerLines('a')} lines in 2 s (the escaped writer is still writing)`);
  const found = L.sh(`for p in /proc/[0-9]*; do c=$(readlink $p/cwd 2>/dev/null); case "$c" in /srv/ws/a*) echo "\${p#/proc/} cwd=$c cmd=$(tr '\\0' ' ' < $p/cmdline | cut -c1-60)";; esac; done`);
  say(`operator scan of /proc/*/cwd under /srv/ws/a:\n${found.split('\n').map((l) => `      ${l}`).join('\n')}`);
  for (const line of found.split('\n').filter((l) => l && !l.includes('managed-runtime-worker'))) { const pid = Number(line.split(' ')[0]); try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  await L.sleep(1000); m0 = L.markerLines('a'); await L.sleep(5000);
  say(`escaped-marker after the operator killed the writer: ${m0} -> ${L.markerLines('a')} lines in 5 s`);
  const ev = L.writeEvidence('evidence-INC-12977.json', recoveryId);
  say(`evidence: ${ev} mode=${(fs.statSync(ev).mode & 0o777).toString(8)} ${fs.readFileSync(ev, 'utf8').slice(0, 120)}…`);
  const done = L.sayMaint('complete', L.maint(['complete', recoveryId, ev])); facts.complete = done.result;

  // ---------------- Phase D: after completion
  say('-- Phase D: after completion');
  say(L.bstr(L.binding(A.sessionId))); say(L.hstr(L.holder('a'))); say(L.astr());
  for (const e of L.executions(bA.id)) say('  execution', e.join(' | '));
  say(`runtime sessions of A: ${JSON.stringify(d.sql(`SELECT runtime_session_id, session_state FROM qwen_runtime_session WHERE binding_id='${bA.id}'`))}`);
  say(`registration of A: ${JSON.stringify(L.registrations().filter((r) => r.pid === workerA).map((r) => ({ file: r.file.slice(0, 12), state: r.state, pid: r.pid })))}`);
  await turn('B turn 3 "HELLO bob"', B, 'HELLO bob');
  await turn('A turn 3 "HELLO alice" (original Session)', A, 'HELLO alice');
  say(`Workspace a files: ${fs.readdirSync('/srv/ws/a/project').join(' ')}`);
  say(`shell calls in Workspace a: ${JSON.stringify(L.shellCalls('a'))}`);
  L.sayMaint('complete-retry-same-file', L.maint(['complete', recoveryId, ev]));
  L.sayMaint('complete-retry-changed-file', L.maint(['complete', recoveryId, L.writeEvidence('evidence-changed.json', recoveryId, { actions: 'changed after the fact' })]));
  L.sayMaint('prepare-after-complete', L.maint(['prepare', bA.id, String(bA.gen), inspection.holderKey, 'INC-12977 escaped writer']));

  say('-- a later holder is never released by the old recovery');
  const pending = B.prompt('SLEEP 12');
  let hb; for (let i = 0; i < 100; i++) { hb = L.holder('a'); if (hb.key !== '<none>' && hb.key !== '<no row>') break; await L.sleep(100); }
  say(`while B sleeps: ${L.hstr(hb)}`);
  L.sayMaint('complete-old-recovery-during-new-holder', L.maint(['complete', recoveryId, ev]));
  say(`after the old complete: ${L.hstr(L.holder('a'))} (same holder: ${L.holder('a').key === hb.key})`);
  const rs = await pending; say('B turn 4 "SLEEP 12":', L.turnSummary(rs));
  say(L.hstr(L.holder('a')));
  say(`server log WARN/ERROR lines: ${L.sh("grep -a -c -E ' (WARN|ERROR) ' /var/log/qwen-w0e3/server.log || true")}; excerpts:\n${L.sh("grep -a -E ' (WARN|ERROR) ' /var/log/qwen-w0e3/server.log | grep -v 'Flyway upgrade recommended' | cut -c1-220 | tail -6 || true")}`);
} catch (e) { if (e.message !== 'stop') { say('!! script error', e.stack); } }
finally { await rig.stop(); fs.writeFileSync(`${L.OUT}/${tag}-facts.json`, JSON.stringify(facts, null, 2)); say(`== ${tag} end`); }
