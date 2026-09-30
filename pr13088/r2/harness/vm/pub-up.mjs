// Long-lived model + Broker ledger proxy + packaged Hosted Harness on a fixed port, for the public (Java connector) path.
import fs from 'node:fs';
import * as L from './lib.mjs';
const model = await L.startModel();
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: 'public', modelUrl: model.baseUrl, brokerUrl: proxy.url, port: 17088 }).start();
fs.writeFileSync(`${L.RUN}/pub-up.json`, JSON.stringify({ pid: process.pid, harnessPid: h.child.pid, harness: h.baseUrl, bootId: h.bootId, model: model.baseUrl }));
setInterval(() => {
  fs.writeFileSync(`${L.RUN}/pub-state.json`, JSON.stringify({ modelCalls: model.state.calls, modelLog: model.state.log.slice(-50), ledger: proxy.ledger.map((e) => ({ url: e.url, status: e.status, code: e.code, at: e.received })) }));
}, 200);
process.on('SIGTERM', async () => { await h.stop(); process.exit(0); });
console.log('PUB-UP', h.baseUrl, h.bootId);
