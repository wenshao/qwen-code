// S5: the registered worker has already exited before the operator arrives (the issue's scenario).
import * as L from './lib.mjs';
const { d } = L;
const tag = process.argv[2] ?? 's5';
L.openLog(tag);
const say = L.say;
L.seedWs('a');
say(`== ${tag}: service jar=${L.env().JAR}; maintenance jar=${L.MAINT_JAR}; db=${d.DB}`);
const rig = await L.startHarness(tag);
try {
  const A = await L.shellSession(rig.h, 'ws-a');
  let r = await A.prompt('ESCAPE'); say('A turn 1 "ESCAPE":', L.turnSummary(r));
  const bA = L.binding(A.sessionId); say(L.bstr(bA)); say(L.hstr(L.holder('a')));
  const handle = d.sql(`SELECT resource_handle_json FROM qwen_runtime_binding WHERE binding_id='${bA.id}'`)[0][0];
  const reg = L.registrations().find((x) => x.handle && handle.includes(JSON.parse(x.handle).resourceId));
  process.kill(reg.pid, 'SIGKILL'); say(`registered worker ${reg.pid} killed; escaped writer still running: ${L.escapedPids().join(',')}`);
  if (process.env.RESTART === '1') {
    const { execFileSync } = await import('node:child_process');
    execFileSync('sudo', ['systemctl', 'restart', 'qwen-w0e3.service']);
    for (let i = 0; i < 90; i++) { const ok = await fetch('http://127.0.0.1:8080/actuator/health').then((x) => x.ok).catch(() => false); if (ok) break; await L.sleep(1000); }
    say('service restarted after the worker died');
  }
  const B = await L.shellSession(rig.h, 'ws-a');
  for (let i = 0; i < 8; i++) {
    r = await B.prompt('HELLO bob'); const b = L.binding(A.sessionId);
    say(`t+${i * 5}s B prompt -> ${r.terminal?.map((t) => t.type).join(',')} ; A ${L.bstr(b)}`);
    if (b.state === 'LOST') break; await L.sleep(5000);
  }
  say(L.hstr(L.holder('a')));
  const ins = L.sayMaint(`${tag}-inspect`, L.maint(['inspect', bA.id, String(bA.gen)]));
  let inspection; try { inspection = JSON.parse(ins.result); } catch { throw new Error('inspect refused'); }
  const recoveryId = L.sayMaint(`${tag}-prepare`, L.maint(['prepare', bA.id, String(bA.gen), inspection.holderKey, 'INC-12977 worker already gone'])).result.trim();
  say(L.bstr(L.binding(A.sessionId))); say(L.hstr(L.holder('a'))); say(L.astr());
  for (const pid of L.escapedPids()) process.kill(pid, 'SIGKILL');
  await L.sleep(1000);
  const ev = L.writeEvidence('evidence-lost.json', recoveryId, { verifiedAt: '2020-01-01T00:00:00Z' });
  say('evidence verifiedAt=2020-01-01T00:00:00Z (before the incident and before prepare)');
  L.sayMaint(`${tag}-complete`, L.maint(['complete', recoveryId, ev]));
  say(L.bstr(L.binding(A.sessionId))); say(L.hstr(L.holder('a'))); say(L.astr());
  for (const x of L.executions(bA.id)) say('  execution', x.join(' | '));
  r = await B.prompt('HELLO bob'); say('B after completion:', L.turnSummary(r));
  r = await A.prompt('HELLO alice'); say('A after completion:', L.turnSummary(r));
  say(`shell calls: ${JSON.stringify(L.shellCalls('a'))}`);
} catch (err) { say('!! stopped:', err.message); }
finally { await rig.stop(); say(`== ${tag} end`); }
