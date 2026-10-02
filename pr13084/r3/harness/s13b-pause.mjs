// s13b: real Aliyun OSS, one publication, then three cycles of "pause the JVM 125 s mid-download, then three Range reads".
import * as L from './lib.mjs';
const ARM = process.env.ARM; L.openLog(`s13b-${ARM}`);
const m = await L.makeOutput('real-pause', `ws-realp-${ARM}-${Date.now().toString(36)}`, process.env.ST ?? 'st-s58', L.genCmd(`realp${ARM}`, 16 * 1024 * 1024 + 3, 0, 0), { turnMs: 600_000 });
const a = m.arts.find((x) => x.stream_role === 'stdout');
L.say('publish', { turn: m.turn.status, results: m.results, shaOk: a?.sha256 === L.genSha(`realp${ARM}`, 'stdout', 16 * 1024 * 1024 + 3) });
for (let c = 1; c <= 3; c++) {
  const progress = { bytes: 0 };
  const dl = L.streamDownload(m.session, a, { progress });
  await L.sleep(800);
  const pid = L.springPid();
  process.kill(pid, 'SIGSTOP'); await L.sleep(125_000); process.kill(pid, 'SIGCONT');
  await dl;
  const after = [];
  for (let i = 0; i < 3; i++) { const r = await L.content(m.session, a.id, { revision: a.revision, range: 'bytes=0-1048575' }); after.push(`${r.status}${r.code ? '/' + r.code : ''}`); }
  L.say(`cycle-${c}`, after.join(', '));
}
