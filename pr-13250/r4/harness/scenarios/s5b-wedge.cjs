// S5b: how long an unanswerable permission prompt wedges a zero-config group on head, and what
// the group sees when the 5-minute ACP permission timeout fires.
const { Run, sleep } = require('../lib.cjs');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const arm = process.argv[2] || 'head';
  const r = new Run('s5b-wedge', arm);
  try {
    r.writeSettings({ senderPolicy: 'open', groupPolicy: 'open' });
    await r.startFakes();
    await r.startChannel();
    const ga = () => r.sends().filter((x) => x.chatId === 'GA');
    const seen = new Set();
    const showNew = () => { for (const x of ga()) if (!seen.has(x.id)) { seen.add(x.id); r.logSend(x); } };
    await r.groupAt('GA', 'U1', 'm-w1', 'TOUCH:wedge.txt');
    let end = Date.now() + 25000;
    while (Date.now() < end && !ga().some((x) => /\/approve/.test(x.text))) await sleep(200);
    showNew();
    const tPrompt = Date.now();
    await r.groupAt('GA', 'U1', 'm-w2', '/approve');
    await sleep(2000);
    showNew();
    await r.groupAt('GA', 'U2', 'm-w3', 'RECALL?');
    end = Date.now() + 420000;
    while (Date.now() < end && !ga().some((x) => x.body.msg_id === 'm-w3')) { await sleep(1000); showNew(); }
    await sleep(3000);
    showNew();
    const ans = ga().find((x) => x.body.msg_id === 'm-w3');
    const wedgeSec = ans ? ((ans.ts - tPrompt) / 1000).toFixed(1) : null;
    r.log(`member U2's follow-up answered ${wedgeSec === null ? 'NEVER (within 7 min)' : wedgeSec + ' s after the permission prompt'}`);
    const log = r.readLog('channel').split('\n').filter((l) => /timed out|permission/i.test(l)).slice(0, 6);
    for (const l of log) r.log(`log: ${l.slice(0, 160)}`);
    fs.writeFileSync(path.join(r.dir, 'summary.json'), JSON.stringify({ wedgeSec, created: fs.existsSync(path.join(r.ws, 'wedge.txt')), sends: ga().map((x) => ({ ts: x.ts, msg_id: x.body.msg_id, seq: x.body.msg_seq, text: x.text })) }, null, 2));
    r.check('scenario completed', true, true);
  } catch (e) {
    r.log('ERROR ' + e.message);
    r.check('scenario completed', e.message, 'no error');
  } finally {
    await r.stop();
    process.exitCode = r.finish();
  }
})();
