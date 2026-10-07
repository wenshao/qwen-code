// S5 (triage's open product question): what an upgraded zero-config QQ group experiences when a
// tool call needs approval. Plain @mention deployment (no sessionScope, no operators).
//   variant zero    : no approvalMode anywhere (what an untouched deployment has)
//   variant default : approvalMode "default" on the channel (tool calls must be approved)
//   variant ops     : as default, plus operators:["U1"] (the documented remedy)
const { Run, sleep } = require('../lib.cjs');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const arm = process.argv[2] || 'head';
  const variant = process.argv[3] || 'default';
  const r = new Run('s5-operators', arm, { suffix: variant });
  const cfg = { senderPolicy: 'open', groupPolicy: 'open' };
  if (variant !== 'zero') cfg.approvalMode = 'default';
  if (variant === 'ops') cfg.operators = ['U1'];
  try {
    r.writeSettings(cfg, variant === 'zero' ? {} : { tools: { approvalMode: 'default' } });
    await r.startFakes();
    await r.startChannel();
    const ga = () => r.sends().filter((x) => x.chatId === 'GA');
    const seen = new Set();
    const showNew = () => { for (const x of ga()) if (!seen.has(x.id)) { seen.add(x.id); r.logSend(x); } };
    await r.groupAt('GA', 'U1', 'm-t1', 'TOUCH:s5-proof.txt');
    let end = Date.now() + 25000;
    while (Date.now() < end && !ga().some((x) => /\/approve|TOOL-RESULT/.test(x.text))) await sleep(200);
    showNew();
    const prompted = ga().some((x) => /\/approve/.test(x.text));
    r.log(`permission prompt posted to group: ${prompted}`);
    if (prompted) {
      await r.groupAt('GA', 'U1', 'm-t2', '/approve');
      end = Date.now() + 15000;
      while (Date.now() < end && !ga().some((x) => x.body.msg_id === 'm-t2' || /TOOL-RESULT/.test(x.text))) await sleep(200);
      await sleep(1500);
      showNew();
      await r.groupAt('GA', 'U2', 'm-t3', '/approve');
      await sleep(3000);
      showNew();
    }
    await sleep(2000);
    const created = fs.existsSync(path.join(r.ws, 's5-proof.txt'));
    r.log(`tool side effect (workspace/s5-proof.txt exists): ${created}`);
    // Is the group session still usable afterwards?
    await r.groupAt('GA', 'U2', 'm-t4', 'RECALL?');
    end = Date.now() + 20000;
    while (Date.now() < end && !ga().some((x) => x.body.msg_id === 'm-t4')) await sleep(200);
    showNew();
    const followUp = ga().find((x) => x.body.msg_id === 'm-t4');
    r.log(`follow-up message from another member answered within 20 s: ${Boolean(followUp)}`);
    await r.groupAt('GA', 'U1', 'm-t5', '/cancel');
    await sleep(3000);
    showNew();
    const res = { arm, variant, prompted, created, followUpAnswered: Boolean(followUp), sends: ga().map((x) => ({ msg_id: x.body.msg_id, text: x.text })) };
    fs.writeFileSync(path.join(r.dir, 'summary.json'), JSON.stringify(res, null, 2));
    r.check('scenario completed', true, true);
  } catch (e) {
    r.log('ERROR ' + e.message);
    r.check('scenario completed', e.message, 'no error');
  } finally {
    await r.stop();
    process.exitCode = r.finish();
  }
})();
