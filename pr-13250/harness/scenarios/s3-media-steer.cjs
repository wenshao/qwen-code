// S3 (new surface): an operator's IMAGE message steers another member's streaming turn in the
// same group thread session. Both arms run with an explicit sessionScope "thread" (no
// groupAllPolicy, so base's constructor does not force 'single'): this isolates the PR's
// seal/cancel boundary machinery from the routing change, on #12850's prepare-then-handle path.
const { Run, sleep } = require('../lib.cjs');
const img = (name, delay) => ({ attachments: [{ url: `https://multimedia.nt.qq.com.cn/${name}.png?delay=${delay}`, content_type: 'image/png', filename: `${name}.png`, size: 68 }] });
(async () => {
  const arm = process.argv[2] || 'head';
  const xf = arm === 'base' ? { expectFail: true } : {};
  const r = new Run('s3-media-steer', arm);
  try {
    r.writeSettings({ senderPolicy: 'open', groupPolicy: 'open', sessionScope: 'thread', operators: ['U1'] });
    await r.startFakes();
    await r.startChannel();
    await r.groupAt('GA', 'U2', 'm-s1', 'SLOW:8');
    await sleep(2500);
    const tSteer = Date.now();
    await r.groupAt('GA', 'U1', 'm-img2', 'IMGS?', img('steer', 200));
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (r.sends().some((x) => /IMGS=/.test(x.text))) break;
      await sleep(200);
    }
    await sleep(4000);
    const ga = r.sends().filter((x) => x.chatId === 'GA');
    for (const x of ga) r.logSend(x);
    const aborted = r.modelLedger().find((e) => e.event === 'slow-aborted');
    r.log(`model: slow stream ${aborted ? `aborted at chunk ${aborted.atChunk}` : 'NOT aborted'}`);
    r.check('steer aborted the in-flight model stream', Boolean(aborted), true);
    const partial = ga.filter((x) => /chunk-/.test(x.text));
    const partialText = partial.map((x) => x.text).join('').match(/chunk-\d/g) || [];
    r.check('cancelled partial anchored to the cancelled turn (m-s1)', partial.map((x) => x.body.msg_id).join(','), (v) => v.length > 0 && v.split(',').every((id) => id === 'm-s1'), { ...xf, describe: 'all m-s1' });
    r.check('cancelled partial delivered exactly once', new Set(partialText).size === partialText.length && partialText.length > 0, true);
    const imgReply = ga.find((x) => /IMGS=/.test(x.text));
    r.check('media turn reply anchored to the image message (m-img2)', imgReply && imgReply.body.msg_id, 'm-img2');
    r.check('media reply not merged with the cancelled partial', imgReply && /chunk-/.test(imgReply.text), false, xf);
    r.check('media turn ran in the shared GA session (sees its image)', imgReply && /FILES=1\b/.test(imgReply.text), true);
    const flushLatency = partial.length ? partial[0].ts - tSteer : null;
    r.log(`partial flushed ${flushLatency} ms after the steering message was dispatched (includes the 200 ms download)`);
    r.check('no unanchored (active) sends', ga.filter((x) => !x.body.msg_id).length, 0);
  } catch (e) {
    r.log('ERROR ' + e.message);
    r.check('scenario completed', e.message, 'no error');
  } finally {
    await r.stop();
    process.exitCode = r.finish();
  }
})();
