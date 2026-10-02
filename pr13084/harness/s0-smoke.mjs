// s0: one real Shell Turn on the PR head; check catalog columns, artifacts and a full + range download.
import * as L from './lib.mjs';
L.openLog('s0-smoke');
const so = 3 * 1024 * 1024 + 333, se = 100 * 1024 + 7;
const r = await L.makeOutput('smoke', 'ws-s0', 'st-s01', L.genCmd('s0', so, se, 3));
L.say('turn', { session: r.session, turn: r.turn.status, err: r.turn.error, ms: r.ms, results: r.results });
L.say('pubs', L.pubRows(r.session));
for (const p of L.pubRows(r.session)) L.say('put-attempts', `${p.id.slice(0, 8)} ${L.putAttempts(p.id)}`);
for (const a of r.arts) {
  const full = await L.content(r.session, a.id, { revision: a.revision });
  const want = L.genSha('s0', a.stream_role, a.stream_role === 'stdout' ? so : se);
  const rng = await L.content(r.session, a.id, { revision: a.revision, range: 'bytes=1000-1999' });
  L.say('artifact', `${a.stream_role} bytes=${a.byte_length} full=${full.status} sha_ok=${L.sha256(full.body) === want && a.sha256 === want} range=${rng.status} ${rng.headers['content-range']} len=${rng.body.length}`);
}
L.out('s0.json', r);
