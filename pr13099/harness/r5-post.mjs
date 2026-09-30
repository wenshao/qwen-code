// VERIFICATION RIG ONLY: rebuild the R5 record from on-disk sources (DB,
// Spring log, tap log, JFR) after the scenario's JFR reader overflowed.
import fs from 'node:fs';
import { R, one, turnRow, tapEntries, springLines, terminalEvents, thrown, out } from './lib.mjs';
const ws = process.argv[2];
const session = one(`SELECT session_id FROM managed_agent_session WHERE workspace_id='${ws}'`);
const started = springLines().filter((l) => l.includes('Started ManagedAgentServerApplication'));
const tUp = Date.parse(started.at(-1).slice(0, 24));
const retries = springLines()
  .filter((l) => l.includes(session) && /will retry|exhausted retries/.test(l))
  .map((l) => ({ at: l.slice(11, 23), tSecAfterRestart: +((Date.parse(l.slice(0, 24)) - tUp) / 1000).toFixed(1), line: l.replace(/^.*?(Managed Turn coordination)/, '$1').replace(/tenant=\S+ session=\S+ turn=\S+ /, '') }));
const calls = tapEntries()
  .filter((e) => e.path?.includes(session) && Date.parse(e.t) >= tUp - 20_000 && !e.path.endsWith('/heartbeat'))
  .map((e) => `${e.t.slice(11, 23)} ${e.method} ${e.path.replace(session, ':id')} -> ${e.status} ${e.code ?? ''}`.trim());
const groups = new Map();
for (const e of await thrown(['DaemonHttpException', 'RuntimeBrokerException'], { sinceMs: tUp })) {
  const key = `${e.cls}|${e.message}|${e.frames.slice(0, 9).join(' <- ')}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
const r = turnRow(session);
const res = {
  scenario: 'r5', workspace: ws, session,
  springRestartedAt: started.at(-1).slice(0, 24),
  springStarts: started.length,
  observedAt: new Date().toISOString(),
  observedSecAfterRestart: +((Date.now() - tUp) / 1000).toFixed(0),
  turn: { status: r[1], error_code: r[2], retry_count: Number(r[3]), submission_attempted: r[4] === '1', admitted: r[5] !== '-' },
  harnessCallsAfterRestart: calls,
  retries,
  terminal: await terminalEvents(session),
  thrownByPath: [...groups].map(([k, count]) => { const [cls, message, frames] = k.split('|'); return { count, cls, message, frames: frames.split(' <- ') }; }),
};
out(`r5b.json`, res);
console.log(JSON.stringify(res, null, 1));
