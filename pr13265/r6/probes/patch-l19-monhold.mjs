// Adds the monHold scenario (round 6): while a Monitor watch runs, does the
// worker count it as holding its Runtime Session, and does the release-time
// drain stop it?
import fs from 'node:fs';

const file = new URL('./l19-executor.mjs', import.meta.url);
let s = fs.readFileSync(file, 'utf8');
const anchor = 'console.log(`[RESULT] ${JSON.stringify(out)}`);';
if (s.split(anchor).length !== 2) throw new Error('anchor');
const scenario = String.raw`if (want('monHold')) {
  const s = await start('s-monhold', 'l19-monhold', 'while true; do echo tick; sleep 0.5; done', 'monitor');
  if (!s.started) out.monHold = { startError: s.startError };
  else {
    await sleep(1000);
    const during = { hasActiveSession: executor.hasActiveSession('s-monhold'), monitorRegistryHolds: executor.monitorRegistry.hasHolds('s-monhold'), unit: events(s.unitName) };
    await executor.stopBackgroundSession('s-monhold');
    await sleep(1500);
    out.monHold = { during, afterStopBackgroundSession: { monitorRegistryHolds: executor.monitorRegistry.hasHolds('s-monhold'), unit: events(s.unitName), live: members(s.unitName) } };
    await executor.monitorRegistry.terminate(s.unitName, 1000).catch(() => {});
  }
}
`;
s = s.replace(anchor, () => scenario + anchor);
fs.writeFileSync(file, s);
console.log('patched');
