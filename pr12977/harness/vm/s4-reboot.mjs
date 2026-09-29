// S4: operator prepared, then the host reboots (TRUSTED=true service, W0e-3 scan on).
// ws-c: incident + prepare (PR arm).  ws-d: same incident, no prepare (control arm).
// usage: s4-reboot.mjs before | after
import fs from 'node:fs';
import * as L from './lib.mjs';
const { d } = L;
const phase = process.argv[2];
L.openLog(`s4-${phase}`);
const say = L.say;
const stateFile = `${L.OUT}/s4-state.json`;
say(`== s4 ${phase}: service jar=${L.env().JAR} trusted=${L.env().TRUSTED} db=${d.DB}; host ${JSON.stringify(d.hostFacts())}`);
if (phase === 'before') {
  L.seedWs('c'); L.seedWs('d');
  const rig = await L.startHarness('s4');
  const st = {};
  try {
    for (const w of ['c', 'd']) {
      const S = await L.shellSession(rig.h, `ws-${w}`);
      const r = await S.prompt('ESCAPE'); say(`ws-${w} turn "ESCAPE":`, L.turnSummary(r));
      const b = L.binding(S.sessionId); say(`ws-${w}`, L.bstr(b)); say(`ws-${w}`, L.hstr(L.holder(w)));
      st[w] = { sid: S.sessionId, bid: b.id, gen: b.gen };
    }
    const ins = JSON.parse(L.sayMaint('s4-inspect-c', L.maint(['inspect', st.c.bid, String(st.c.gen)])).result);
    st.recoveryId = L.sayMaint('s4-prepare-c', L.maint(['prepare', st.c.bid, String(st.c.gen), ins.holderKey, 'INC-12977 reboot drill'])).result.trim();
    st.holderKey = ins.holderKey;
    for (const w of ['c', 'd']) { say(`ws-${w}`, L.bstr(L.binding(st[w].sid))); say(`ws-${w}`, L.hstr(L.holder(w))); }
    say(L.astr());
    say(`escaped writers: ${L.escapedPids().join(',')}; markers c=${L.markerLines('c')} d=${L.markerLines('d')}`);
    fs.writeFileSync(stateFile, JSON.stringify(st));
  } finally { await rig.stop(); }
} else {
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  say(`escaped writers after reboot: ${L.escapedPids().join(',') || 'none'}; markers c=${L.markerLines('c')} d=${L.markerLines('d')}`);
  // Give the W0e-3 scan several rounds (5 s interval).
  for (let i = 0; i < 12; i++) {
    const c = L.binding(st.c.sid); const dd = L.binding(st.d.sid);
    say(`t+${i * 5}s ws-c ${c.state} ${L.hstr(L.holder('c'))} | ws-d ${dd.state} ${L.hstr(L.holder('d'))}`);
    if (i >= 6 && dd.state === 'RELEASED') break;
    await L.sleep(5000);
  }
  for (const w of ['c', 'd']) { const b = L.binding(st[w].sid); say(`ws-${w}`, L.bstr(b)); for (const e of L.executions(b.id)) say(`  ws-${w} execution`, e.join(' | ')); }
  say(L.astr());
  say(`registrations: ${JSON.stringify(L.registrations().map((r) => ({ state: r.state, pid: r.pid, boot: JSON.parse(r.handle).bootId.slice(0, 8) })))}`);
  L.sayMaint('s4-after-inspect-c', L.maint(['inspect', st.c.bid, String(st.c.gen)]));
  const ev = L.writeEvidence('evidence-reboot.json', st.recoveryId, { method: 'host rebooted', actions: 'Host rebooted; every process of the old boot is gone' });
  L.sayMaint('s4-after-complete-c', L.maint(['complete', st.recoveryId, ev]));
  L.sayMaint('s4-after-prepare-c-again', L.maint(['prepare', st.c.bid, String(st.c.gen), st.holderKey, 'INC-12977 reboot drill']));
  say(`ws-c ${L.bstr(L.binding(st.c.sid))}; ${L.hstr(L.holder('c'))}`);
  const rig = await L.startHarness('s4b');
  try {
    for (const w of ['c', 'd']) {
      const S = await L.shellSession(rig.h, `ws-${w}`);
      const r = await S.prompt(`HELLO after${w}`); say(`new Session on ws-${w} after reboot:`, L.turnSummary(r));
    }
  } finally { await rig.stop(); }
  say(`server log scan lines: ${L.sh("grep -a -c -iE 'recover' /var/log/qwen-w0e3/server.log || true")}; WARN/ERROR: ${L.sh("grep -a -E ' (WARN|ERROR) ' /var/log/qwen-w0e3/server.log | grep -v 'Flyway upgrade' | cut -c1-200 | tail -4 || true")}`);
}
say(`== s4 ${phase} end`);
