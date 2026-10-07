const { Run } = require('../lib.cjs');
(async () => {
  const arm = process.argv[2] || 'head';
  const r = new Run('s0-smoke', arm);
  try {
    r.writeSettings({ senderPolicy: 'open', groupPolicy: 'open' });
    await r.startFakes();
    await r.startChannel();
    await r.c2c('U9', 'm-dm-1', 'hello there');
    const s = await r.waitSend((x) => x.chatId === 'U9', 30000);
    if (s) r.logSend(s);
    r.check('DM reply', s && s.text, 'ACK');
    r.check('DM reply anchored to inbound', s && s.body.msg_id, 'm-dm-1');
  } catch (e) {
    r.log('ERROR ' + e.message);
  } finally {
    await r.stop();
    process.exitCode = r.finish();
  }
})();
