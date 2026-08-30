import fs from 'node:fs';
const dir = '/Users/wenshao/git/rig-10357/out';
const scen = process.argv.slice(2);
for (const s of scen) {
  console.log('==================== ' + s);
  for (const v of ['base', 'head']) {
    const f = `${dir}/${v}-${s}.json`;
    if (!fs.existsSync(f)) { console.log(`${v}: MISSING`); continue; }
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    const fi = r.finalInstance;
    console.log(`${v.padEnd(5)} wall=${r.wallMs}ms cardReq=${r.requestCount} bytes=${r.uploadedBytes} fallbacks=${r.fallbacks.length}`);
    console.log(`      finalInstance: len=${fi.contentLen} flowStatus=${fi.flowStatus} stop=${fi.stopAction} status="${fi.statusLine}"`);
    for (const c of r.clients) {
      console.log(`      client ${c.name}: len=${c.finalContentLen} flow=${c.finalFlowStatus} stop=${c.finalStopAction} status="${c.finalStatusLine}" missedFrames=${c.missedStreamFramesAfterReconnect} regressions=${JSON.stringify(c.contentRegressions)}`);
    }
    const errs = r.requests.filter((x) => x.status !== 200);
    console.log(`      injected failures=${errs.length}`);
  }
}
