// s12: the reply of the admission object's PUT (admissions > 64 KiB go to OSS) is lost once.
import * as L from './lib.mjs';
L.openLog('s12-admission-put');
const ADM = '6a6ba702490a3747917518200e696dead01e32cbdcdca0dd3ac2bf3568982ab5'; // sha256("admission"), the key suffix
await L.oss('/clear-faults', {});
const t0 = Date.now();
await L.oss('/fault', { op: 'put', mode: 'drop-reply', count: 1, match: ADM });
const m = await L.makeOutput('admission-put', `ws-adm-${Date.now().toString(36)}`, process.env.ST ?? 'st-s38', L.genCmd('obsE', 2 * 1024 * 1024 + 1, 0, 0));
const p = L.pubRows(m.session)[0];
const puts = (await L.ossLedger()).filter((e) => e.t >= t0 && e.method === 'PUT' && e.key.endsWith(ADM)).map((e) => e.status);
const adm = L.sql(`SELECT state FROM qwen_output_put_attempt WHERE publication_id='${p.id}' AND object_key LIKE '%${ADM}'`).map((r) => r[0]);
L.say('result', { turn: m.turn.status, results: m.results, phase: p.phase, admissionPuts: puts, admissionAttempts: adm, allAttempts: L.putAttempts(p.id) });
await L.oss('/clear-faults', {});
