// D on the previous head (989baf22 jar = DriverManagerDataSource, r2 CLI child): same storage, same 2 GiB file, wait_timeout=2.
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
L.openLog('r2-d-old');
const { say } = L;
const m = L.mountRow('a'); const R = `${L.root('a')}/project`;
L.sh(`head -c 2G /dev/zero > ${R}/big.bin`);
const { bundle } = W.prepareBundle('r2-d-old', { sessions: W.members('a').map((x) => x.id) });
const q = W.captureRequest({ fence: m.operation, revision: m.revision, bundle, dist: 'dist-r2' });
L.sql('SET GLOBAL wait_timeout=2');
let r; try { r = await W.w1b('capture', q, { oss: true, jar: '/opt/w1b/head-server-workspace-bundle.jar', label: 'D-old-wait-timeout-2s' }); } finally { L.sql('SET GLOBAL wait_timeout=28800'); }
say(`   old head, wait_timeout=2: exit=${r.code} ${W.opStr(W.opRow(q.operationId))} cause="${(r.cause || '').slice(0, 120)}"`);
fs.writeFileSync(`${L.OUT}/r2-d-old.json`, JSON.stringify({ exit: r.code, summary: W.summary(r), ms: r.ms }));
L.sh(`rm -f ${R}/big.bin; rm -rf ${bundle}`); say('D-OLD-DONE');
