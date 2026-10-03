// S4 (not executed in round 2): daemon-managed channel worker — `qwen serve --channel qq`.
// Same zero-config cells as S1, routed through daemon-worker.ts instead of start.ts.
const { Run, sleep } = require('../lib.cjs');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const arm = process.argv[2] || 'head';
  const xf = arm === 'base' ? { expectFail: true } : {};
  const r = new Run('s4-daemon', arm);
  try {
    r.writeSettings({ senderPolicy: 'open', groupPolicy: 'open', groupAllPolicy: 'all', groups: { '*': { requireMention: false } } });
    await r.startFakes();
    await r.startChannel('serve');
    const boot = r.readLog('serve');
    r.check('boot: no forced-single warning', /Forcing sessionScope/.test(boot), false, xf);
    const reply = async (id, chat) => {
      const s = await r.waitSend((x) => x.chatId === chat && x.body.msg_id === id, 40000);
      if (s) r.logSend(s);
      return s;
    };
    await r.groupAll('GA', 'U1', 'm-a1', 'REMEMBER:PP-DAEMON');
    let s = await reply('m-a1', 'GA');
    r.check('GA/U1 noted', s && s.text, 'NOTED PP-DAEMON');
    await r.groupAll('GA', 'U2', 'm-a2', 'RECALL?');
    s = await reply('m-a2', 'GA');
    r.check('GA/U2 recalls U1 passphrase (shared group context)', s && s.text, 'RECALL=PP-DAEMON', xf);
    await r.groupAll('GB', 'U3', 'm-b1', 'RECALL?');
    s = await reply('m-b1', 'GB');
    r.check('GB/U3 isolated from GA', s && s.text, 'RECALL=NONE');
    await r.c2c('U2', 'm-d1', 'RECALL?');
    s = await reply('m-d1', 'U2');
    r.check('DM U2 isolated from GA', s && s.text, 'RECALL=NONE');
    await sleep(1000);
    // daemon router persists to the same channels/sessions.json under QWEN_HOME
    const files = fs.readdirSync(path.join(r.home, 'channels')).join(' ');
    r.log(`channels dir: ${files}`);
    const keys = r.sessionKeys();
    r.check('routing keys', keys.join(' '), 'qq:GA qq:GB qq:U2', xf);
    await r.c2c('U2', 'm-d2', '/clear');
    s = await r.waitSend((x) => x.chatId === 'U2' && x.body.msg_id === 'm-d2', 20000);
    if (s) r.logSend(s);
    r.check('DM /clear acts directly', s && s.text, (t) => typeof t === 'string' && /clear/i.test(t) && !/Only authorized/.test(t), { ...xf, describe: 'cleared, not refused' });
  } catch (e) {
    r.log('ERROR ' + e.message);
    r.check('scenario completed', e.message, 'no error');
  } finally {
    await r.stop();
    process.exitCode = r.finish();
  }
})();
