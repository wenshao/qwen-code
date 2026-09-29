// S6 (base 62584d31, before this PR): the same incident has no way out.
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const { d } = L;
L.openLog('s6-base');
const say = L.say;
L.seedWs('a');
say(`== s6 base: service jar=${L.env().JAR}; db=${d.DB}`);
const rig = await L.startHarness('s6');
try {
  const A = await L.shellSession(rig.h, 'ws-a');
  let r = await A.prompt('ESCAPE'); say('A turn 1 "ESCAPE":', L.turnSummary(r));
  const bA = L.binding(A.sessionId); say(L.bstr(bA)); say(L.hstr(L.holder('a')));
  for (const x of L.executions(bA.id)) say('  execution', x.join(' | '));
  const B = await L.shellSession(rig.h, 'ws-a');
  r = await B.prompt('HELLO bob'); say('B turn 1:', L.turnSummary(r));
  const handle = d.sql(`SELECT resource_handle_json FROM qwen_runtime_binding WHERE binding_id='${bA.id}'`)[0][0];
  const reg = L.registrations().find((x) => x.handle && handle.includes(JSON.parse(x.handle).resourceId));
  for (const pid of [reg.pid, ...L.escapedPids()]) process.kill(pid, 'SIGKILL');
  say(`killed registered worker ${reg.pid} and the escaped writer; waiting 30 s`);
  await L.sleep(30000);
  r = await B.prompt('HELLO bob'); say('B turn 2 (all writers gone):', L.turnSummary(r));
  say(L.bstr(L.binding(A.sessionId))); say(L.hstr(L.holder('a')));
  execFileSync('sudo', ['systemctl', 'restart', 'qwen-w0e3.service']);
  for (let i = 0; i < 90; i++) { const ok = await fetch('http://127.0.0.1:8080/actuator/health').then((x) => x.ok).catch(() => false); if (ok) break; await L.sleep(1000); }
  say('service restarted');
  await L.sleep(15000);
  r = await B.prompt('HELLO bob'); say('B turn 3 (after service restart):', L.turnSummary(r));
  say(L.bstr(L.binding(A.sessionId))); say(L.hstr(L.holder('a')));
  say(`operator-recovery artifact in base jar: ${L.sh("unzip -l /opt/qwen/pr12977-base-server.jar 2>/dev/null | grep -c WorkspaceRecoveryCommand || true")}`);
} catch (err) { say('!! stopped:', err.stack); }
finally { await rig.stop(); say('== s6 end'); }
