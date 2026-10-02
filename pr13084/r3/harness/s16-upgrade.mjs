// s16: data written by current main (47463b79, schema through the V29 Java backfill), then the PR head (V30).
import fs from 'node:fs';
import * as L from './lib.mjs';
const PHASE = process.env.PHASE; L.openLog(`s16-${PHASE}`);
const SF = `${L.R}/out/s16-state.json`;
if (PHASE === 'make') {
  const m = await L.makeOutput('upgrade', `ws-up-${Date.now().toString(36)}`, process.env.ST ?? 'st-s48', L.genCmd('s16up', 2 * 1024 * 1024 + 5, 0, 0));
  fs.writeFileSync(SF, JSON.stringify({ session: m.session, arts: m.arts }));
  L.say('made-on-main', { session: m.session, turn: m.turn.status, results: m.results, history: L.sql("SELECT version FROM flyway_schema_history WHERE version IN ('27','28','29','30') ORDER BY installed_rank").map((r) => r[0]) });
} else {
  const st = JSON.parse(fs.readFileSync(SF, 'utf8'));
  L.say('history', L.sql("SELECT version, description, success FROM flyway_schema_history WHERE version IN ('27','28','29','30') ORDER BY installed_rank").map((r) => r.join(' ')));
  L.say('old-row', L.pubRows(st.session));
  for (const a of st.arts) L.say('old-download', `${a.stream_role} ${await L.downloadCheck(st.session, a, a.sha256)}`);
  L.say('retire-old', L.opSeam(st.session, 'DELETE').split('\n').at(-1).replace(/^op \S+ /, ''));
}
