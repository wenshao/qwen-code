// Extra probes: concurrency across conversations, duplicate markers, trailing-space path, huge path, CRLF
import * as L from './lib.mjs';
const ws = process.argv[2];
const say = (text, extra = 'CHUNK:4') => `SAYB64:${L.b64(text)} ${extra}`.trim();
const noPath = (s) => !s.includes(ws) && !s.includes('[FILE:');
// X1 two conversations at once, different files
{
  const t0 = Date.now();
  await Promise.all([
    L.sendMessage({ text: say(`A\n[FILE: ${ws}/m1.txt]`, 'CHUNK:2 DELAY:30'), conversationId: 'conv-x1a', isMentioned: true }),
    L.sendMessage({ text: say(`B\n[FILE: ${ws}/m2.txt]`, 'CHUNK:2 DELAY:30'), conversationId: 'conv-x1b', isMentioned: true }),
  ]);
  const e = await L.settle({ after: t0, quiet: 3000 });
  const files = L.fileSends(e).filter((x) => x.t > t0);
  const names = files.map((f) => f.body.file.fileName).sort().join();
  L.check('X1 two concurrent conversations each get exactly their own file (m1, m2)', names === 'm1.txt,m2.txt' && files.length === 2, names);
  L.check('X1 both file messages were posted through the sessionWebhook endpoint (robot/send)', files.every((f) => f.path === '/robot/send'), JSON.stringify(files.map((f) => f.path)));
}
// X2 same file referenced twice -> two uploads, two messages (no dedupe claimed)
{
  const t0 = await L.turn({ conversationId: 'conv-x2', directive: say(`[FILE: ${ws}/m3.txt]\n[FILE: ${ws}/m3.txt]`) });
  const e = await L.settle({ after: t0 });
  L.check('X2 duplicate marker -> delivered twice (observation, no dedupe)', L.fileSends(e).filter((x) => x.t > t0).length === 2 && L.uploads(e).filter((x) => x.t > t0).length === 2);
}
// X3 trailing space inside the marker, CRLF line ending, 4100-char path
{
  const long = `${ws}/` + 'a'.repeat(4100);
  const t0 = await L.turn({ conversationId: 'conv-x3', directive: say(`[FILE: ${ws}/m4.txt ]\r\n[FILE: ${ws}/m5.txt]\r\n[FILE: ${long}]\nend`) });
  const e = await L.settle({ after: t0 });
  const md = L.mdSends(e).filter((x) => x.t > t0)[0]?.body.markdown.text ?? '';
  const files = L.fileSends(e).filter((x) => x.t > t0).map((f) => f.body.file.fileName);
  L.check('X3 CRLF marker line accepted (m5 delivered); trailing-space path + 4100-char path rejected as invalid markers (ONE aggregated notice)', files.join() === 'm5.txt' && (md.match(/invalid marker/g) || []).length === 1, `files=${files.join()} md=${JSON.stringify(md)}`);
  L.check('X3 no path leaked', noPath(L.outText(e, t0)) && !L.outText(e, t0).includes('aaaaaaaaaa'));
}
L.summary();
