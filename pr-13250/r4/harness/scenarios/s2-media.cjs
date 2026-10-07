// S2 (new surface since round 2): inbound media from #12850 under the PR's thread scope.
// Phase A: an image sent by one member lands in the GROUP's shared session (another member's
//          turn sees it); other groups and DMs do not; every reply anchors to its own message.
// Phase B: a media turn arrives while another member's turn is still streaming in the SAME
//          group session; the stream's chunks and the media turn's reply must keep their own anchors.
const { Run, sleep } = require('../lib.cjs');
const img = (name, delay) => ({ attachments: [{ url: `https://multimedia.nt.qq.com.cn/${name}.png?delay=${delay}`, content_type: 'image/png', filename: `${name}.png`, size: 68 }] });
(async () => {
  const arm = process.argv[2] || 'head';
  const xf = arm === 'base' ? { expectFail: true } : {};
  const r = new Run('s2-media', arm);
  try {
    r.writeSettings({ senderPolicy: 'open', groupPolicy: 'open', groupAllPolicy: 'all', groups: { '*': { requireMention: false } } });
    await r.startFakes();
    await r.startChannel();
    const reply = async (id, chat, t = 30000) => {
      const s = await r.waitSend((x) => x.chatId === chat && x.body.msg_id === id, t);
      if (s) r.logSend(s);
      return s;
    };
    // ---- Phase A ----
    await r.groupAt('GA', 'U1', 'm-img1', '', img('cat', 1500));
    let s = await reply('m-img1', 'GA');
    r.check('A: GA/U1 image-only turn answered, anchored to the image message', s && s.body.msg_id, 'm-img1');
    await r.groupAll('GA', 'U2', 'm-a2', 'IMGS?');
    s = await reply('m-a2', 'GA');
    r.check("A: GA/U2's turn sees U1's image (shared group session)", s && s.text, (t) => /FILES=1\b/.test(t || ''), { ...xf, describe: 'FILES=1' });
    await r.groupAll('GB', 'U3', 'm-b1', 'IMGS?');
    s = await reply('m-b1', 'GB');
    r.check('A: GB/U3 does not see GA image', s && s.text, (t) => /FILES=0\b/.test(t || ''), { describe: 'FILES=0' });
    await r.c2c('U2', 'm-d1', 'IMGS?');
    s = await reply('m-d1', 'U2');
    r.check('A: DM U2 does not see GA image', s && s.text, (t) => /FILES=0\b/.test(t || ''), { describe: 'FILES=0' });
    // ---- Phase B ----
    await r.groupAll('GA', 'U2', 'm-s1', 'SLOW:5');
    await sleep(1500);
    await r.groupAt('GA', 'U1', 'm-img2', 'IMGS?', img('dog', 200));
    const end = Date.now() + 40000;
    let imgReply = null;
    while (Date.now() < end) {
      imgReply = r.sends().find((x) => x.chatId === 'GA' && /IMGS=/.test(x.text) && x.body.msg_id === 'm-img2');
      const streamDone = r.sends().some((x) => x.chatId === 'GA' && /chunk-5/.test(x.text));
      if (imgReply && streamDone) break;
      await sleep(200);
    }
    await sleep(2500);
    const phaseB = r.sends().filter((x) => x.chatId === 'GA' && (/chunk-/.test(x.text) || /IMGS=/.test(x.text)) && ['m-s1', 'm-img2'].includes(x.body.msg_id) || (x.chatId === 'GA' && !x.body.msg_id));
    for (const x of phaseB) r.logSend(x);
    const chunkSends = phaseB.filter((x) => /chunk-/.test(x.text));
    r.check('B: every streamed chunk anchored to the streaming turn (m-s1)', chunkSends.map((x) => x.body.msg_id).join(','), (v) => v.length > 0 && v.split(',').every((id) => id === 'm-s1'), { describe: 'all m-s1' });
    r.check('B: streamed text delivered exactly once', chunkSends.map((x) => x.text).join('').match(/chunk-\d/g)?.join(' '), 'chunk-1 chunk-2 chunk-3 chunk-4 chunk-5');
    r.check('B: media turn reply anchored to its own image message (m-img2)', imgReply && imgReply.body.msg_id, 'm-img2');
    r.check('B: no chunk text leaked into the media reply', imgReply && /chunk-/.test(imgReply.text), false);
    r.check('B: no unanchored (active) sends', phaseB.filter((x) => !x.body.msg_id).length, 0);
    const keys = r.sessionKeys();
    r.check('routing keys', keys.join(' '), 'qq:GA qq:GB qq:U2', xf);
    const ml = r.modelLedger().filter((e) => e.main && /IMGS\?/.test(e.lastUserText || ''));
    r.log(`model saw IMGS? turns: ${ml.map((e) => `images=${e.images} userTurns=${e.userTurns}`).join(' | ')}`);
    const media = r.qqLedger().filter((e) => e.kind === 'media-get');
    r.check('attachments fetched over the spoofed TLS host', media.length, 2);
  } catch (e) {
    r.log('ERROR ' + e.message);
    r.check('scenario completed', e.message, 'no error');
  } finally {
    await r.stop();
    process.exitCode = r.finish();
  }
})();
