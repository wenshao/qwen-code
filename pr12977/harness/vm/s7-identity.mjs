// S7: who can run the maintenance command, and what the audit row records as the operator.
import * as L from './lib.mjs';
const { d } = L;
L.openLog('s7-identity');
const say = L.say;
L.seedWs('a');
const rig = await L.startHarness('s7');
try {
  const A = await L.shellSession(rig.h, 'ws-a');
  const r = await A.prompt('ESCAPE'); say('A turn 1 "ESCAPE":', L.turnSummary(r));
  const b = L.binding(A.sessionId);
  L.sayMaint('s7-inspect-as-root', L.maint(['inspect', b.id, String(b.gen)], { user: 'root' }));
  L.sayMaint('s7-inspect-as-service-user-named-alice', L.maint(['inspect', b.id, String(b.gen)], { javaOpts: ['-Duser.name=alice'] }));
  const ins = JSON.parse(L.sayMaint('s7-inspect-as-service-user', L.maint(['inspect', b.id, String(b.gen)])).result);
  L.sayMaint('s7-prepare-as-root', L.maint(['prepare', b.id, String(b.gen), ins.holderKey, 'INC-12977 identity probe'], { user: 'root' }));
  const sudoUser = L.maint(['prepare', b.id, String(b.gen), ins.holderKey, 'INC-12977 identity probe'], { extraEnv: { SUDO_USER: 'alice', LOGNAME: 'alice', USER: 'alice' } });
  L.sayMaint('s7-prepare-by-alice-via-sudo-u-service-user', sudoUser);
  say(L.astr());
  const again = L.maint(['prepare', b.id, String(b.gen), ins.holderKey, 'INC-12977 identity probe'], { extraEnv: { SUDO_USER: 'bob', LOGNAME: 'bob', USER: 'bob' } });
  L.sayMaint('s7-prepare-repeat-by-bob-via-sudo-u-service-user', again);
  say(`loginuid of the maintenance shell: ${L.sh('cat /proc/self/loginuid')}`);
} catch (err) { say('!! stopped:', err.stack); }
finally { await rig.stop(); say('== s7 end'); }
